import { z } from "zod";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface QuoteLineItemDto {
  id: string;
  quoteVersionId: string;
  productId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  lineTotal: number;
  sortOrder: number;
}

export interface QuoteVersionDto {
  id: string;
  quoteId: string;
  versionNumber: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  lineItems: QuoteLineItemDto[];
}

export interface QuoteDto {
  id: string;
  organizationId: string;
  sequenceNumber: number;
  /** "Q-00001", computed from sequenceNumber at the serialization boundary — not stored. */
  quoteNumber: string;
  accountId: string;
  contactId: string | null;
  opportunityId: string | null;
  ownerId: string | null;
  templateId: string | null;
  status: QuoteStatus;
  currentVersion: number;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  validUntil: string | null;
  shareToken: string | null;
  notes: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateLineItemDto {
  productId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxPercent?: number;
}

export interface QuoteTemplateDto {
  id: string;
  organizationId: string;
  name: string;
  termsText: string | null;
  defaultNotes: string | null;
  defaultLineItems: TemplateLineItemDto[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What an unauthenticated recipient sees at /public/quotes/:token. */
export interface PublicQuoteViewDto {
  quote: QuoteDto;
  version: QuoteVersionDto;
  organizationName: string;
  accountName: string;
}

export const lineItemInputSchema = z.object({
  productId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  quantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
  discountPercent: z.number().min(0).max(100).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
});
export type LineItemInput = z.infer<typeof lineItemInputSchema>;

export const createQuoteSchema = z
  .object({
    accountId: z.string().uuid(),
    contactId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
    currency: z.string().trim().min(1).max(10).default("USD"),
    validUntil: z.string().datetime().optional(),
    notes: z.string().trim().max(5000).optional(),
    lineItems: z.array(lineItemInputSchema).default([]),
  })
  .refine((input) => input.lineItems.length > 0 || Boolean(input.templateId), {
    message: "lineItems is required unless templateId is provided",
    path: ["lineItems"],
  });
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

// Excludes accountId — fixed at creation. Draft-only, enforced in the
// service (a locked/sent quote must go through /revise, not PATCH).
export const updateQuoteSchema = z.object({
  contactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  validUntil: z.string().datetime().optional(),
  notes: z.string().trim().max(5000).optional(),
  lineItems: z.array(lineItemInputSchema).min(1).optional(),
});
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  termsText: z.string().trim().max(10000).optional(),
  defaultNotes: z.string().trim().max(5000).optional(),
  defaultLineItems: z.array(lineItemInputSchema).default([]),
  isDefault: z.boolean().default(false),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
