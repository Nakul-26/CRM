import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, eq, isNull } from "drizzle-orm";
import type {
  AssignTicketInput,
  CreateTicketCommentInput,
  CreateTicketInput,
  TicketStatus,
  UpdateTicketInput,
} from "@sales-platform/contracts";
import type { ApiEnv } from "@sales-platform/config";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { accounts, contacts, ticketComments, tickets } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { SlaPoliciesService } from "../sla-policies/sla-policies.service";
import { computeTicketSlaFlags } from "./ticket-sla";

type TicketRow = typeof tickets.$inferSelect;
type TicketCommentRow = typeof ticketComments.$inferSelect;

// closed/resolved are never terminal — a ticket can always reopen.
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function assertValidTicketTransition(from: TicketStatus, to: TicketStatus) {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Ticket cannot move from "${from}" to "${to}"`);
  }
}

function serializeTicket(row: TicketRow) {
  const flags = computeTicketSlaFlags(
    {
      status: row.status as TicketStatus,
      firstResponseDueAt: row.firstResponseDueAt,
      firstRespondedAt: row.firstRespondedAt,
      resolutionDueAt: row.resolutionDueAt,
    },
    new Date(),
  );

  return {
    ...row,
    status: row.status as TicketStatus,
    firstResponseDueAt: row.firstResponseDueAt ? row.firstResponseDueAt.toISOString() : null,
    resolutionDueAt: row.resolutionDueAt ? row.resolutionDueAt.toISOString() : null,
    firstRespondedAt: row.firstRespondedAt ? row.firstRespondedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...flags,
  };
}

function serializeComment(row: TicketCommentRow) {
  return { ...row, source: row.source as "internal" | "inbound_email", createdAt: row.createdAt.toISOString() };
}

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly slaPolicies: SlaPoliciesService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  /** `ticket+<replyToken>@INBOUND_EMAIL_DOMAIN` — see docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md. */
  private buildReplyTo(replyToken: string): string {
    return `ticket+${replyToken}@${this.config.get("INBOUND_EMAIL_DOMAIN", { infer: true })}`;
  }

  async list(organizationId: string, filters?: { status?: TicketStatus; priority?: string; assigneeId?: string }) {
    const conditions = [eq(tickets.organizationId, organizationId), isNull(tickets.deletedAt)];
    if (filters?.status) conditions.push(eq(tickets.status, filters.status));
    if (filters?.priority) conditions.push(eq(tickets.priority, filters.priority));
    if (filters?.assigneeId) conditions.push(eq(tickets.assigneeId, filters.assigneeId));

    const rows = await this.db
      .select()
      .from(tickets)
      .where(and(...conditions))
      .orderBy(asc(tickets.createdAt));
    return rows.map(serializeTicket);
  }

  async findById(organizationId: string, ticketId: string) {
    return serializeTicket(await this.getRawTicket(organizationId, ticketId));
  }

  async create(organizationId: string, actorId: string, input: CreateTicketInput) {
    await this.requireAccountInOrganization(organizationId, input.accountId);
    const contact = input.contactId ? await this.findContactForEmail(organizationId, input.contactId) : null;
    if (input.contactId && !contact) throw new NotFoundException(`Contact ${input.contactId} not found`);

    const policy = await this.slaPolicies.findByPriority(organizationId, input.priority);
    const now = Date.now();

    const [ticket] = await this.db
      .insert(tickets)
      .values({
        organizationId,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        accountId: input.accountId,
        contactId: input.contactId,
        slaPolicyId: policy?.id,
        firstResponseDueAt: policy ? new Date(now + policy.firstResponseTargetMinutes * 60_000) : undefined,
        resolutionDueAt: policy ? new Date(now + policy.resolutionTargetMinutes * 60_000) : undefined,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    this.events.publish({
      eventType: "ticket.created",
      organizationId,
      actorId,
      payload: {
        ticketId: ticket.id,
        accountId: ticket.accountId,
        contactId: ticket.contactId,
        subject: ticket.subject,
        contactEmail: contact?.email ?? null,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        replyTo: this.buildReplyTo(ticket.replyToken),
      },
    });
    return serializeTicket(ticket);
  }

  async update(organizationId: string, actorId: string, ticketId: string, input: UpdateTicketInput) {
    await this.getRawTicket(organizationId, ticketId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);

    const [ticket] = await this.db
      .update(tickets)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId)))
      .returning();

    this.events.publish({
      eventType: "ticket.updated",
      organizationId,
      actorId,
      payload: { ticketId, accountId: ticket.accountId, changes: input },
    });
    return serializeTicket(ticket);
  }

  async updateStatus(organizationId: string, actorId: string, ticketId: string, status: TicketStatus) {
    const existing = await this.getRawTicket(organizationId, ticketId);
    assertValidTicketTransition(existing.status as TicketStatus, status);

    const [ticket] = await this.db
      .update(tickets)
      .set({
        status,
        resolvedAt: status === "resolved" ? new Date() : null,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId)))
      .returning();

    this.events.publish({
      eventType: "ticket.status_changed",
      organizationId,
      actorId,
      payload: { ticketId, accountId: ticket.accountId, from: existing.status, to: status },
    });
    return serializeTicket(ticket);
  }

  async assign(organizationId: string, actorId: string, ticketId: string, input: AssignTicketInput) {
    const existing = await this.getRawTicket(organizationId, ticketId);

    const [ticket] = await this.db
      .update(tickets)
      .set({ assigneeId: input.assigneeId, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId)))
      .returning();

    this.events.publish({
      eventType: "ticket.assigned",
      organizationId,
      actorId,
      payload: { ticketId, accountId: existing.accountId, assigneeId: input.assigneeId },
    });
    return serializeTicket(ticket);
  }

  async delete(organizationId: string, actorId: string, ticketId: string) {
    await this.getRawTicket(organizationId, ticketId);

    await this.db
      .update(tickets)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId)));

    this.events.publish({
      eventType: "ticket.deleted",
      organizationId,
      actorId,
      payload: { ticketId },
    });
  }

  async listComments(organizationId: string, ticketId: string) {
    await this.getRawTicket(organizationId, ticketId);
    const rows = await this.db
      .select()
      .from(ticketComments)
      .where(and(eq(ticketComments.organizationId, organizationId), eq(ticketComments.ticketId, ticketId)))
      .orderBy(asc(ticketComments.createdAt));
    return rows.map(serializeComment);
  }

  async addComment(organizationId: string, actorId: string, ticketId: string, input: CreateTicketCommentInput) {
    const ticket = await this.getRawTicket(organizationId, ticketId);

    const [comment] = await this.db
      .insert(ticketComments)
      .values({ organizationId, ticketId, authorId: actorId, body: input.body, isPublic: input.isPublic, source: "internal" })
      .returning();

    if (input.isPublic && !ticket.firstRespondedAt) {
      await this.db
        .update(tickets)
        .set({ firstRespondedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId)));
    }

    const contact = input.isPublic && ticket.contactId ? await this.findContactForEmail(organizationId, ticket.contactId) : null;

    this.events.publish({
      eventType: "ticket.comment_added",
      organizationId,
      actorId,
      payload: {
        ticketId,
        accountId: ticket.accountId,
        contactId: ticket.contactId,
        body: comment.body,
        isPublic: comment.isPublic,
        source: "internal",
        contactEmail: contact?.email ?? null,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        replyTo: input.isPublic ? this.buildReplyTo(ticket.replyToken) : null,
      },
    });
    return serializeComment(comment);
  }

  /**
   * The inbound-email webhook's only entry point into ticket data — looked
   * up by replyToken alone (no organizationId filter), the same
   * public-by-token model as quotes' shareToken lookup. Returns `null` if
   * no ticket owns this token, `"duplicate"` if this exact external
   * message was already recorded (idempotent redelivery), or the created
   * comment. See docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md.
   */
  async addInboundEmailComment(
    replyToken: string,
    input: { body: string; externalMessageId?: string },
  ): Promise<ReturnType<typeof serializeComment> | "duplicate" | null> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.replyToken, replyToken), isNull(tickets.deletedAt)))
      .limit(1);
    if (!ticket) return null;

    if (input.externalMessageId) {
      const [existing] = await this.db
        .select({ id: ticketComments.id })
        .from(ticketComments)
        .where(eq(ticketComments.externalMessageId, input.externalMessageId))
        .limit(1);
      if (existing) return "duplicate";
    }

    const [comment] = await this.db
      .insert(ticketComments)
      .values({
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        authorId: null,
        body: input.body,
        isPublic: true,
        source: "inbound_email",
        externalMessageId: input.externalMessageId,
      })
      .returning();

    // A customer reply always reopens a resolved/closed ticket — always
    // reopenable, same as a staff-driven status change.
    if (ticket.status === "resolved" || ticket.status === "closed") {
      const [updated] = await this.db
        .update(tickets)
        .set({ status: "open", updatedAt: new Date() })
        .where(eq(tickets.id, ticket.id))
        .returning();
      this.events.publish({
        eventType: "ticket.status_changed",
        organizationId: ticket.organizationId,
        payload: { ticketId: ticket.id, accountId: updated.accountId, from: ticket.status, to: "open" },
      });
    }

    // Deliberately no contactEmail/replyTo — a customer's own reply must
    // never be echoed back to them (see MailListener.onTicketCommentAdded).
    this.events.publish({
      eventType: "ticket.comment_added",
      organizationId: ticket.organizationId,
      payload: {
        ticketId: ticket.id,
        accountId: ticket.accountId,
        contactId: ticket.contactId,
        body: comment.body,
        isPublic: true,
        source: "inbound_email",
      },
    });
    return serializeComment(comment);
  }

  private async getRawTicket(organizationId: string, ticketId: string): Promise<TicketRow> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId), eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      .limit(1);
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);
    return ticket;
  }

  private async requireAccountInOrganization(organizationId: string, accountId: string) {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
  }

  private async requireContactInOrganization(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);
  }

  /** Snapshot lookup for email dispatch — the contact's address/name at the moment the triggering action happened. */
  private async findContactForEmail(organizationId: string, contactId: string) {
    const [contact] = await this.db
      .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    return contact ?? null;
  }
}
