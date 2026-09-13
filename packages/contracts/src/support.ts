import { z } from "zod";

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_COMMENT_SOURCES = ["internal", "inbound_email"] as const;
export type TicketCommentSource = (typeof TICKET_COMMENT_SOURCES)[number];

export interface TicketDto {
  id: string;
  organizationId: string;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  accountId: string;
  contactId: string | null;
  assigneeId: string | null;
  slaPolicyId: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  /** Computed read-time from status/dueAt/respondedAt — never persisted. */
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCommentDto {
  id: string;
  ticketId: string;
  authorId: string | null;
  body: string;
  isPublic: boolean;
  source: TicketCommentSource;
  createdAt: string;
}

export interface SlaPolicyDto {
  id: string;
  organizationId: string;
  name: string;
  priority: TicketPriority;
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface KbArticleDto {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  category: string | null;
  body: string;
  tags: string[];
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).optional(),
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).optional(),
  contactId: z.string().uuid().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const updateTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;

export const assignTicketSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

export const createTicketCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  isPublic: z.boolean().default(true),
});
export type CreateTicketCommentInput = z.infer<typeof createTicketCommentSchema>;

// Generic, provider-agnostic shape a real inbound-email-parsing provider
// (e.g. Postmark/Mailgun inbound routes) would forward — see
// docs/decisions/0021-inbound-email-ticket-parsing-phase21-scope.md.
export const inboundEmailWebhookSchema = z.object({
  to: z.string().trim().min(1),
  from: z.string().trim().min(1),
  subject: z.string().trim().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  messageId: z.string().trim().optional(),
});
export type InboundEmailWebhookInput = z.infer<typeof inboundEmailWebhookSchema>;

export const createSlaPolicySchema = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(TICKET_PRIORITIES),
  firstResponseTargetMinutes: z.number().int().min(1),
  resolutionTargetMinutes: z.number().int().min(1),
});
export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;

export const updateSlaPolicySchema = createSlaPolicySchema.partial();
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createKbArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200).regex(slugPattern, "slug must be lowercase, alphanumeric, and hyphen-separated"),
  category: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1).max(60)).default([]),
});
export type CreateKbArticleInput = z.infer<typeof createKbArticleSchema>;

export const updateKbArticleSchema = createKbArticleSchema.partial();
export type UpdateKbArticleInput = z.infer<typeof updateKbArticleSchema>;
