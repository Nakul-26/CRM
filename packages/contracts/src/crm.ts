import { z } from "zod";

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "task"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface AccountDto {
  id: string;
  organizationId: string;
  name: string;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: Address | null;
  shippingAddress: Address | null;
  tags: string[];
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  organizationId: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  ownerId: string | null;
  socialProfiles: Record<string, string> | null;
  communicationPreferences: { email?: boolean; phone?: boolean; sms?: boolean } | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDto {
  id: string;
  organizationId: string;
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  type: ActivityType;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntryDto {
  id: string;
  source: "activity" | "event";
  type: string;
  occurredAt: string;
  actorId?: string;
  accountId: string;
  contactId?: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface SearchResultDto {
  id: string;
  type: "account" | "contact" | "lead";
  label: string;
  subLabel?: string;
  rank: number;
}

const addressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(40).optional(),
    country: z.string().trim().max(120).optional(),
  })
  .optional();

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(120).optional(),
  companySize: z.enum(COMPANY_SIZES).optional(),
  website: z.string().trim().url().optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(40).optional(),
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  tags: z.array(z.string().trim().min(1)).default([]),
  ownerId: z.string().uuid().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = createAccountSchema.partial();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const createContactSchema = z.object({
  accountId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  ownerId: z.string().uuid().optional(),
  socialProfiles: z.record(z.string(), z.string()).optional(),
  communicationPreferences: z
    .object({ email: z.boolean().optional(), phone: z.boolean().optional(), sms: z.boolean().optional() })
    .optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const createActivitySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().max(5000).optional(),
    dueAt: z.string().datetime().optional(),
    ownerId: z.string().uuid().optional(),
  })
  .refine((input) => Boolean(input.accountId || input.contactId || input.opportunityId), {
    message: "One of accountId, contactId, or opportunityId is required",
    path: ["accountId"],
  });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(5000).optional(),
  dueAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
