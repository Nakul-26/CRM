import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { CreateLeadInput, LeadStatus, UpdateLeadInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, contacts, leads, opportunities, users } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { PipelinesService } from "../../sales/pipelines/pipelines.service";
import { ScoringRulesService } from "../scoring/scoring-rules.service";
import { computeLeadScore, type LeadScoringFields, type LeadScoringRuleLike } from "../scoring/evaluate-lead-score";

/**
 * Used by every status-mutating endpoint (/contact, /qualify, /convert —
 * plain PATCH never carries `status`, see updateLeadSchema). Qualified is
 * reachable straight from New or Contacted (fast-qualify is common), but
 * /contact exists so "we reached out" can be recorded distinctly.
 * Converted is terminal — no further transitions once converted, mirroring
 * §35's "an accepted quotation cannot be silently modified" rule.
 */
const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  New: ["Contacted", "Qualified", "Unqualified"],
  Contacted: ["Qualified", "Unqualified"],
  Qualified: ["Converted", "Unqualified"],
  Unqualified: ["Contacted"],
  Converted: [],
};

export function assertValidLeadTransition(from: LeadStatus, to: LeadStatus) {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Lead cannot move from "${from}" to "${to}"`);
  }
}

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly scoringRules: ScoringRulesService,
    private readonly pipelines: PipelinesService,
  ) {}

  async list(organizationId: string, status?: string) {
    const conditions = [eq(leads.organizationId, organizationId), isNull(leads.deletedAt)];
    if (status) conditions.push(eq(leads.status, status));
    return this.db.select().from(leads).where(and(...conditions));
  }

  async findById(organizationId: string, leadId: string) {
    const [lead] = await this.db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId), isNull(leads.deletedAt)))
      .limit(1);
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);
    return lead;
  }

  async create(organizationId: string, actorId: string, input: CreateLeadInput) {
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const score = await this.scoreFor(organizationId, input);

    const [lead] = await this.db
      .insert(leads)
      .values({
        organizationId,
        ...input,
        estimatedValue: input.estimatedValue !== undefined ? String(input.estimatedValue) : undefined,
        score,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    this.events.publish({
      eventType: "lead.created",
      organizationId,
      actorId,
      payload: { leadId: lead.id, name: lead.name, source: lead.source },
    });
    return lead;
  }

  async update(organizationId: string, actorId: string, leadId: string, input: UpdateLeadInput) {
    const existing = await this.findById(organizationId, leadId);
    if (input.ownerId) {
      await this.requireUserInOrganization(organizationId, input.ownerId);
    }

    const score = await this.scoreFor(organizationId, { ...existing, ...input });

    const [lead] = await this.db
      .update(leads)
      .set({
        ...input,
        estimatedValue: input.estimatedValue !== undefined ? String(input.estimatedValue) : undefined,
        score,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
      .returning();

    this.events.publish({
      eventType: "lead.updated",
      organizationId,
      actorId,
      payload: { leadId, changes: input },
    });
    return lead;
  }

  async delete(organizationId: string, actorId: string, leadId: string) {
    await this.findById(organizationId, leadId);

    await this.db
      .update(leads)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)));

    this.events.publish({
      eventType: "lead.deleted",
      organizationId,
      actorId,
      payload: { leadId },
    });
  }

  async recalculateScore(organizationId: string, actorId: string, leadId: string) {
    const existing = await this.findById(organizationId, leadId);
    const score = await this.scoreFor(organizationId, existing);

    const [lead] = await this.db
      .update(leads)
      .set({ score, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
      .returning();
    return lead;
  }

  async markContacted(organizationId: string, actorId: string, leadId: string) {
    return this.transitionTo(organizationId, actorId, leadId, "Contacted");
  }

  async qualify(organizationId: string, actorId: string, leadId: string, outcome: "qualified" | "unqualified") {
    return this.transitionTo(organizationId, actorId, leadId, outcome === "qualified" ? "Qualified" : "Unqualified");
  }

  /**
   * Reuse-or-create Account/Contact, atomically, then mark the lead
   * Converted. This is the one place the leads module writes directly to
   * `crm.accounts`/`crm.contacts` instead of going through
   * AccountsService/ContactsService: those services aren't
   * transaction-composable (each binds its own top-level `db`), and
   * atomicity across leads+crm here matters more than the module
   * boundary — a lead that "converted" but left no Account, or a
   * half-created Account with no linked lead, is worse than this one
   * documented exception. If this module is ever split into its own
   * service, this becomes a call to the CRM service's API instead.
   *
   * As of Phase 4, the same transaction also creates an Opportunity
   * (against the org's default pipeline, first stage) — extending this
   * existing exception rather than introducing a new one, exactly as
   * ADR 0003 said would happen once the Sales domain existed.
   */
  async convert(organizationId: string, actorId: string, leadId: string) {
    const lead = await this.findById(organizationId, leadId);
    if (lead.status !== "Qualified") {
      throw new BadRequestException(`Lead must be Qualified before converting (current status: ${lead.status})`);
    }

    // getOrCreateDefault runs its own transaction internally, so it can't be
    // nested inside the one below — resolved up front instead.
    const defaultPipeline = await this.pipelines.getOrCreateDefault(organizationId);
    const firstStage = await this.pipelines.firstStage(organizationId, defaultPipeline.id);

    const outcome = await this.db.transaction(async (tx) => {
      let reusedExistingAccount = false;
      let account: typeof accounts.$inferSelect | undefined;
      if (lead.company) {
        [account] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.organizationId, organizationId),
              sql`lower(${accounts.name}) = lower(${lead.company})`,
              isNull(accounts.deletedAt),
            ),
          )
          .limit(1);
      }
      if (account) {
        reusedExistingAccount = true;
      } else {
        [account] = await tx
          .insert(accounts)
          .values({
            organizationId,
            name: lead.company ?? lead.name,
            industry: lead.industry,
            ownerId: lead.ownerId,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
      }

      let reusedExistingContact = false;
      let contact: typeof contacts.$inferSelect | undefined;
      if (lead.email) {
        [contact] = await tx
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.organizationId, organizationId),
              sql`lower(${contacts.email}) = lower(${lead.email})`,
              isNull(contacts.deletedAt),
            ),
          )
          .limit(1);
      }
      if (contact) {
        reusedExistingContact = true;
        if (!contact.accountId) {
          [contact] = await tx
            .update(contacts)
            .set({ accountId: account.id, updatedAt: new Date(), updatedBy: actorId })
            .where(eq(contacts.id, contact.id))
            .returning();
        }
      } else {
        const [firstName, ...rest] = lead.name.trim().split(/\s+/);
        const lastName = rest.join(" ") || "-";
        [contact] = await tx
          .insert(contacts)
          .values({
            organizationId,
            accountId: account.id,
            firstName: firstName || lead.name,
            lastName,
            email: lead.email,
            phone: lead.phone,
            ownerId: lead.ownerId,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
      }

      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          organizationId,
          name: `${lead.company ?? lead.name} - New Business`,
          accountId: account.id,
          contactId: contact.id,
          ownerId: lead.ownerId,
          pipelineId: defaultPipeline.id,
          stageId: firstStage.id,
          probability: firstStage.probability,
          source: lead.source,
          value: lead.estimatedValue ?? undefined,
          currency: lead.currency,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      const [updatedLead] = await tx
        .update(leads)
        .set({
          status: "Converted",
          convertedAccountId: account.id,
          convertedContactId: contact.id,
          convertedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
        .returning();

      return { lead: updatedLead, account, contact, opportunity, reusedExistingAccount, reusedExistingContact };
    });

    this.events.publish({
      eventType: "lead.converted",
      organizationId,
      actorId,
      payload: {
        leadId,
        accountId: outcome.account.id,
        contactId: outcome.contact.id,
        opportunityId: outcome.opportunity.id,
        reusedExistingAccount: outcome.reusedExistingAccount,
        reusedExistingContact: outcome.reusedExistingContact,
      },
    });

    this.events.publish({
      eventType: "opportunity.created",
      organizationId,
      actorId,
      payload: { opportunityId: outcome.opportunity.id, accountId: outcome.account.id, name: outcome.opportunity.name },
    });

    return outcome;
  }

  private async transitionTo(organizationId: string, actorId: string, leadId: string, toStatus: LeadStatus) {
    const lead = await this.findById(organizationId, leadId);
    assertValidLeadTransition(lead.status as LeadStatus, toStatus);

    const [updated] = await this.db
      .update(leads)
      .set({ status: toStatus, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
      .returning();

    this.events.publish({
      eventType: "lead.status_changed",
      organizationId,
      actorId,
      payload: { leadId, fromStatus: lead.status, toStatus },
    });
    return updated;
  }

  async duplicates(organizationId: string, email?: string, company?: string) {
    if (!email && !company) return [];

    const conditions = [];
    if (email) conditions.push(sql`lower(${leads.email}) = lower(${email})`);
    if (company) conditions.push(sql`lower(${leads.company}) = lower(${company})`);

    return this.db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.deletedAt), or(...conditions)));
  }

  async statsBySource(organizationId: string) {
    const rows = await this.db
      .select({ source: leads.source, count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), isNull(leads.deletedAt)))
      .groupBy(leads.source);
    return rows;
  }

  private async scoreFor(
    organizationId: string,
    fields: {
      companySize?: string | null;
      email?: string | null;
      source?: string | null;
      industry?: string | null;
      estimatedValue?: string | number | null;
    },
  ) {
    const rules = await this.scoringRules.listActive(organizationId);
    const leadFields: LeadScoringFields = {
      companySize: fields.companySize ?? null,
      email: fields.email ?? null,
      source: fields.source ?? null,
      industry: fields.industry ?? null,
      estimatedValue:
        fields.estimatedValue === undefined || fields.estimatedValue === null ? null : Number(fields.estimatedValue),
    };
    // Rules come from Postgres `text` columns (field/operator), only ever
    // populated through the zod-validated scoring-rule endpoints, so the
    // narrower LeadScoringRuleLike union always holds at runtime.
    return computeLeadScore(rules as unknown as LeadScoringRuleLike[], leadFields);
  }

  private async requireUserInOrganization(organizationId: string, userId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
  }
}
