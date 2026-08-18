import { randomUUID } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import type {
  CreateQuoteInput,
  CreateTemplateInput,
  LineItemInput,
  QuoteStatus,
  UpdateQuoteInput,
  UpdateTemplateInput,
} from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database, type Db } from "../../database/database.module";
import { quoteLineItems, quotes, quoteTemplates, quoteVersions } from "../../database/schema";
import { accounts, contacts } from "../../database/schema/crm.schema";
import { opportunities } from "../../database/schema/sales.schema";
import { organizations } from "../../database/schema/identity.schema";
import { DomainEventBus } from "../../shared/events/domain-event-bus";
import { ProductsService } from "../products/products.service";

type QuoteRow = typeof quotes.$inferSelect;
type QuoteVersionRow = typeof quoteVersions.$inferSelect;
type QuoteLineItemRow = typeof quoteLineItems.$inferSelect;

// draft is reachable from sent/rejected/expired only via /revise (not listed
// here — that's a distinct action from a plain status transition).
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface ComputedLineItem extends LineItemInput {
  discountPercent: number;
  taxPercent: number;
  lineTotal: number;
  sortOrder: number;
}

function computeTotals(items: LineItemInput[]) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;

  const computedItems: ComputedLineItem[] = items.map((item, index) => {
    const discountPercent = item.discountPercent ?? 0;
    const taxPercent = item.taxPercent ?? 0;
    const gross = item.quantity * item.unitPrice;
    const discount = gross * (discountPercent / 100);
    const net = gross - discount;
    const tax = net * (taxPercent / 100);

    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;

    return { ...item, discountPercent, taxPercent, lineTotal: round2(net + tax), sortOrder: index };
  });

  return {
    items: computedItems,
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxTotal: round2(taxTotal),
    total: round2(subtotal - discountTotal + taxTotal),
  };
}

function serializeQuote(row: QuoteRow) {
  return {
    ...row,
    status: row.status as QuoteStatus,
    quoteNumber: `Q-${String(row.sequenceNumber).padStart(5, "0")}`,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discountTotal),
    taxTotal: Number(row.taxTotal),
    total: Number(row.total),
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLineItem(row: QuoteLineItemRow) {
  return {
    ...row,
    unitPrice: Number(row.unitPrice),
    discountPercent: Number(row.discountPercent),
    taxPercent: Number(row.taxPercent),
    lineTotal: Number(row.lineTotal),
  };
}

function serializeVersion(row: QuoteVersionRow, lineItems: QuoteLineItemRow[]) {
  return {
    ...row,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discountTotal),
    taxTotal: Number(row.taxTotal),
    total: Number(row.total),
    createdAt: row.createdAt.toISOString(),
    lineItems: lineItems.map(serializeLineItem),
  };
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
    private readonly products: ProductsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  async list(organizationId: string, filters?: { status?: QuoteStatus; accountId?: string; opportunityId?: string }) {
    const conditions = [eq(quotes.organizationId, organizationId), isNull(quotes.deletedAt)];
    if (filters?.status) conditions.push(eq(quotes.status, filters.status));
    if (filters?.accountId) conditions.push(eq(quotes.accountId, filters.accountId));
    if (filters?.opportunityId) conditions.push(eq(quotes.opportunityId, filters.opportunityId));

    const rows = await this.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(asc(quotes.sequenceNumber));

    const expired = await Promise.all(rows.map((row) => this.expireIfDue(row)));
    return expired.map(serializeQuote);
  }

  async findById(organizationId: string, quoteId: string) {
    let quote = await this.getRawQuote(organizationId, quoteId);
    quote = await this.expireIfDue(quote);
    const version = await this.getVersionWithItems(organizationId, quote.id, quote.currentVersion);
    return { quote: serializeQuote(quote), version };
  }

  async create(organizationId: string, actorId: string, input: CreateQuoteInput) {
    await this.requireAccountInOrganization(organizationId, input.accountId);
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);
    if (input.opportunityId) await this.requireOpportunityInOrganization(organizationId, input.opportunityId);

    let template: typeof quoteTemplates.$inferSelect | undefined;
    if (input.templateId) template = await this.findRawTemplate(organizationId, input.templateId);

    let lineItemsInput = input.lineItems;
    if (lineItemsInput.length === 0 && template) {
      lineItemsInput = template.defaultLineItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent ?? 0,
        taxPercent: item.taxPercent ?? 0,
      }));
    }
    if (lineItemsInput.length === 0) throw new BadRequestException("At least one line item is required");

    await this.validateProductReferences(organizationId, lineItemsInput);

    const notes = input.notes ?? template?.defaultNotes ?? undefined;
    const totals = computeTotals(lineItemsInput);

    const quote = await this.db.transaction(async (tx) => {
      const [quoteRow] = await tx
        .insert(quotes)
        .values({
          organizationId,
          accountId: input.accountId,
          contactId: input.contactId,
          opportunityId: input.opportunityId,
          ownerId: actorId,
          templateId: input.templateId,
          currency: input.currency,
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          notes,
          subtotal: totals.subtotal.toString(),
          discountTotal: totals.discountTotal.toString(),
          taxTotal: totals.taxTotal.toString(),
          total: totals.total.toString(),
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      await this.writeVersion(tx, organizationId, quoteRow.id, 1, totals, input.currency, notes, actorId);
      return quoteRow;
    });

    this.events.publish({
      eventType: "quote.created",
      organizationId,
      actorId,
      payload: { quoteId: quote.id, accountId: quote.accountId, opportunityId: quote.opportunityId },
    });
    return this.findById(organizationId, quote.id);
  }

  async update(organizationId: string, actorId: string, quoteId: string, input: UpdateQuoteInput) {
    let quote = await this.getRawQuote(organizationId, quoteId);
    quote = await this.expireIfDue(quote);
    if (quote.status !== "draft") {
      throw new BadRequestException(`Cannot edit a quote in status "${quote.status}" — use /revise to create a new draft version`);
    }
    if (input.contactId) await this.requireContactInOrganization(organizationId, input.contactId);
    if (input.opportunityId) await this.requireOpportunityInOrganization(organizationId, input.opportunityId);

    const existing = await this.getVersionWithItems(organizationId, quote.id, quote.currentVersion);
    const lineItemsInput: LineItemInput[] =
      input.lineItems ??
      existing.lineItems.map((item) => ({
        productId: item.productId ?? undefined,
        name: item.name,
        description: item.description ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        taxPercent: item.taxPercent,
      }));

    await this.validateProductReferences(organizationId, lineItemsInput);

    const totals = computeTotals(lineItemsInput);
    const notes = input.notes !== undefined ? input.notes : quote.notes ?? undefined;
    const currency = input.currency ?? quote.currency;

    await this.db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({
          contactId: input.contactId ?? quote.contactId,
          opportunityId: input.opportunityId ?? quote.opportunityId,
          currency,
          validUntil: input.validUntil ? new Date(input.validUntil) : quote.validUntil,
          notes,
          subtotal: totals.subtotal.toString(),
          discountTotal: totals.discountTotal.toString(),
          taxTotal: totals.taxTotal.toString(),
          total: totals.total.toString(),
          updatedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(quotes.id, quote.id));

      await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteVersionId, existing.id));
      await tx
        .update(quoteVersions)
        .set({
          subtotal: totals.subtotal.toString(),
          discountTotal: totals.discountTotal.toString(),
          taxTotal: totals.taxTotal.toString(),
          total: totals.total.toString(),
          currency,
          notes,
        })
        .where(eq(quoteVersions.id, existing.id));

      await this.insertLineItems(tx, organizationId, existing.id, totals.items);
    });

    this.events.publish({
      eventType: "quote.updated",
      organizationId,
      actorId,
      payload: { quoteId: quote.id, accountId: quote.accountId },
    });
    return this.findById(organizationId, quote.id);
  }

  async delete(organizationId: string, actorId: string, quoteId: string) {
    let quote = await this.getRawQuote(organizationId, quoteId);
    quote = await this.expireIfDue(quote);
    if (quote.status !== "draft") throw new BadRequestException(`Cannot delete a quote in status "${quote.status}"`);

    await this.db
      .update(quotes)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, quoteId)));

    this.events.publish({
      eventType: "quote.deleted",
      organizationId,
      actorId,
      payload: { quoteId },
    });
  }

  async send(organizationId: string, actorId: string, quoteId: string) {
    let quote = await this.getRawQuote(organizationId, quoteId);
    quote = await this.expireIfDue(quote);
    this.assertTransition(quote.status as QuoteStatus, "sent");

    const shareToken = quote.shareToken ?? randomUUID();
    await this.db
      .update(quotes)
      .set({ status: "sent", shareToken, sentAt: new Date(), updatedAt: new Date(), updatedBy: actorId })
      .where(eq(quotes.id, quote.id));

    const contact = quote.contactId ? await this.findContactForEmail(organizationId, quote.contactId) : null;
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });

    this.events.publish({
      eventType: "quote.sent",
      organizationId,
      actorId,
      payload: {
        quoteId: quote.id,
        accountId: quote.accountId,
        shareToken,
        contactEmail: contact?.email ?? null,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        publicUrl: `${webAppUrl}/public/quotes/${shareToken}`,
      },
    });
    return this.findById(organizationId, quote.id);
  }

  /** Clones the latest version into a new draft version, reopening a locked quote for editing. */
  async revise(organizationId: string, actorId: string, quoteId: string) {
    let quote = await this.getRawQuote(organizationId, quoteId);
    quote = await this.expireIfDue(quote);
    if (!["sent", "rejected", "expired"].includes(quote.status)) {
      throw new BadRequestException(`Cannot revise a quote in status "${quote.status}"`);
    }

    const [currentVersion] = await this.db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, quote.id), eq(quoteVersions.versionNumber, quote.currentVersion)))
      .limit(1);
    const currentItems = await this.db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteVersionId, currentVersion.id));

    const newVersionNumber = quote.currentVersion + 1;
    await this.db.transaction(async (tx) => {
      const [version] = await tx
        .insert(quoteVersions)
        .values({
          organizationId,
          quoteId: quote.id,
          versionNumber: newVersionNumber,
          subtotal: currentVersion.subtotal,
          discountTotal: currentVersion.discountTotal,
          taxTotal: currentVersion.taxTotal,
          total: currentVersion.total,
          currency: currentVersion.currency,
          notes: currentVersion.notes,
          createdBy: actorId,
        })
        .returning();

      await tx.insert(quoteLineItems).values(
        currentItems.map((item) => ({
          organizationId,
          quoteVersionId: version.id,
          productId: item.productId,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent,
          taxPercent: item.taxPercent,
          lineTotal: item.lineTotal,
          sortOrder: item.sortOrder,
        })),
      );

      await tx
        .update(quotes)
        .set({ status: "draft", currentVersion: newVersionNumber, updatedAt: new Date(), updatedBy: actorId })
        .where(eq(quotes.id, quote.id));
    });

    this.events.publish({
      eventType: "quote.revised",
      organizationId,
      actorId,
      payload: { quoteId: quote.id, accountId: quote.accountId, versionNumber: newVersionNumber },
    });
    return this.findById(organizationId, quote.id);
  }

  async versions(organizationId: string, quoteId: string) {
    await this.getRawQuote(organizationId, quoteId);
    const rows = await this.db
      .select()
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quoteId))
      .orderBy(asc(quoteVersions.versionNumber));
    return Promise.all(
      rows.map(async (version) => {
        const items = await this.db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteVersionId, version.id)).orderBy(asc(quoteLineItems.sortOrder));
        return serializeVersion(version, items);
      }),
    );
  }

  // ---- Public (unauthenticated) surface — looked up by shareToken, not organizationId/JWT. ----

  async findByToken(token: string) {
    let quote = await this.getRawQuoteByToken(token);
    quote = await this.expireIfDue(quote);
    const version = await this.getVersionWithItems(quote.organizationId, quote.id, quote.currentVersion);

    const [account] = await this.db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, quote.accountId)).limit(1);
    const [org] = await this.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, quote.organizationId)).limit(1);

    return { quote: serializeQuote(quote), version, organizationName: org?.name ?? "", accountName: account?.name ?? "" };
  }

  async acceptByToken(token: string) {
    let quote = await this.getRawQuoteByToken(token);
    quote = await this.expireIfDue(quote);
    this.assertTransition(quote.status as QuoteStatus, "accepted");

    await this.db.update(quotes).set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));

    this.events.publish({
      eventType: "quote.accepted",
      organizationId: quote.organizationId,
      payload: { quoteId: quote.id, accountId: quote.accountId, opportunityId: quote.opportunityId },
    });
    return this.findByToken(token);
  }

  async rejectByToken(token: string) {
    let quote = await this.getRawQuoteByToken(token);
    quote = await this.expireIfDue(quote);
    this.assertTransition(quote.status as QuoteStatus, "rejected");

    await this.db.update(quotes).set({ status: "rejected", rejectedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, quote.id));

    this.events.publish({
      eventType: "quote.rejected",
      organizationId: quote.organizationId,
      payload: { quoteId: quote.id, accountId: quote.accountId },
    });
    return this.findByToken(token);
  }

  // ---- PDF support (Checkpoint F) ----

  async pdfSnapshot(organizationId: string, quoteId: string, versionNumber?: number) {
    const quote = await this.getRawQuote(organizationId, quoteId);
    return this.buildPdfSnapshot(quote, versionNumber);
  }

  async pdfSnapshotByToken(token: string, versionNumber?: number) {
    const quote = await this.getRawQuoteByToken(token);
    return this.buildPdfSnapshot(quote, versionNumber);
  }

  private async buildPdfSnapshot(quote: QuoteRow, versionNumber?: number) {
    const version = await this.getVersionWithItems(quote.organizationId, quote.id, versionNumber ?? quote.currentVersion);
    const [account] = await this.db.select().from(accounts).where(eq(accounts.id, quote.accountId)).limit(1);
    const [contact] = quote.contactId
      ? await this.db.select().from(contacts).where(eq(contacts.id, quote.contactId)).limit(1)
      : [undefined];
    const [org] = await this.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, quote.organizationId)).limit(1);

    return { quote: serializeQuote(quote), version, account, contact, organizationName: org?.name ?? "" };
  }

  // ---- Templates ----

  async listTemplates(organizationId: string) {
    return this.db
      .select()
      .from(quoteTemplates)
      .where(and(eq(quoteTemplates.organizationId, organizationId), isNull(quoteTemplates.deletedAt)))
      .orderBy(asc(quoteTemplates.name));
  }

  async findTemplate(organizationId: string, templateId: string) {
    return this.findRawTemplate(organizationId, templateId);
  }

  async createTemplate(organizationId: string, actorId: string, input: CreateTemplateInput) {
    const [template] = await this.db
      .insert(quoteTemplates)
      .values({ organizationId, ...input, createdBy: actorId, updatedBy: actorId })
      .returning();

    this.events.publish({
      eventType: "quote_template.created",
      organizationId,
      actorId,
      payload: { templateId: template.id, name: template.name },
    });
    return template;
  }

  async updateTemplate(organizationId: string, actorId: string, templateId: string, input: UpdateTemplateInput) {
    await this.findRawTemplate(organizationId, templateId);

    const [template] = await this.db
      .update(quoteTemplates)
      .set({ ...input, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(quoteTemplates.organizationId, organizationId), eq(quoteTemplates.id, templateId)))
      .returning();

    this.events.publish({
      eventType: "quote_template.updated",
      organizationId,
      actorId,
      payload: { templateId, changes: input },
    });
    return template;
  }

  async deleteTemplate(organizationId: string, actorId: string, templateId: string) {
    await this.findRawTemplate(organizationId, templateId);

    await this.db
      .update(quoteTemplates)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(quoteTemplates.organizationId, organizationId), eq(quoteTemplates.id, templateId)));

    this.events.publish({
      eventType: "quote_template.deleted",
      organizationId,
      actorId,
      payload: { templateId },
    });
  }

  // ---- Internals ----

  private assertTransition(from: QuoteStatus, to: QuoteStatus) {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot move a quote from "${from}" to "${to}"`);
    }
  }

  /** Checked/persisted on access ("touch-on-access") — no scheduler exists yet (see ADR 0005). */
  private async expireIfDue(quote: QuoteRow): Promise<QuoteRow> {
    if (quote.status !== "sent" || !quote.validUntil || quote.validUntil > new Date()) return quote;

    await this.db.update(quotes).set({ status: "expired", updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    this.events.publish({
      eventType: "quote.expired",
      organizationId: quote.organizationId,
      payload: { quoteId: quote.id, accountId: quote.accountId },
    });
    return { ...quote, status: "expired" };
  }

  private async getRawQuote(organizationId: string, quoteId: string): Promise<QuoteRow> {
    const [quote] = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, quoteId), isNull(quotes.deletedAt)))
      .limit(1);
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    return quote;
  }

  private async getRawQuoteByToken(token: string): Promise<QuoteRow> {
    const [quote] = await this.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.shareToken, token), isNull(quotes.deletedAt)))
      .limit(1);
    if (!quote) throw new NotFoundException("Quote not found");
    return quote;
  }

  private async getVersionWithItems(organizationId: string, quoteId: string, versionNumber: number) {
    const [version] = await this.db
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.organizationId, organizationId), eq(quoteVersions.quoteId, quoteId), eq(quoteVersions.versionNumber, versionNumber)))
      .limit(1);
    if (!version) throw new NotFoundException(`Version ${versionNumber} not found for quote ${quoteId}`);

    const items = await this.db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteVersionId, version.id)).orderBy(asc(quoteLineItems.sortOrder));
    return serializeVersion(version, items);
  }

  private async writeVersion(
    tx: Db,
    organizationId: string,
    quoteId: string,
    versionNumber: number,
    totals: ReturnType<typeof computeTotals>,
    currency: string,
    notes: string | undefined,
    actorId: string,
  ) {
    const [version] = await tx
      .insert(quoteVersions)
      .values({
        organizationId,
        quoteId,
        versionNumber,
        subtotal: totals.subtotal.toString(),
        discountTotal: totals.discountTotal.toString(),
        taxTotal: totals.taxTotal.toString(),
        total: totals.total.toString(),
        currency,
        notes,
        createdBy: actorId,
      })
      .returning();

    await this.insertLineItems(tx, organizationId, version.id, totals.items);
    return version;
  }

  private async insertLineItems(tx: Db, organizationId: string, quoteVersionId: string, items: ComputedLineItem[]) {
    await tx.insert(quoteLineItems).values(
      items.map((item) => ({
        organizationId,
        quoteVersionId,
        productId: item.productId,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountPercent: item.discountPercent.toString(),
        taxPercent: item.taxPercent.toString(),
        lineTotal: item.lineTotal.toString(),
        sortOrder: item.sortOrder,
      })),
    );
  }

  private async validateProductReferences(organizationId: string, items: LineItemInput[]) {
    for (const item of items) {
      if (item.productId) await this.products.findById(organizationId, item.productId);
    }
  }

  private async findRawTemplate(organizationId: string, templateId: string) {
    const [template] = await this.db
      .select()
      .from(quoteTemplates)
      .where(and(eq(quoteTemplates.organizationId, organizationId), eq(quoteTemplates.id, templateId), isNull(quoteTemplates.deletedAt)))
      .limit(1);
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);
    return template;
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

  private async requireOpportunityInOrganization(organizationId: string, opportunityId: string) {
    const [opportunity] = await this.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId), isNull(opportunities.deletedAt)))
      .limit(1);
    if (!opportunity) throw new NotFoundException(`Opportunity ${opportunityId} not found`);
  }
}
