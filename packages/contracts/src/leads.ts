import { z } from "zod";

export const LEAD_SOURCES = [
  "website",
  "referral",
  "advertisement",
  "linkedin",
  "cold_outreach",
  "event",
  "import",
  "api",
  "partner",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Unqualified", "Converted"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SCORING_FIELDS = ["companySize", "email", "source", "industry", "estimatedValue"] as const;
export type LeadScoringField = (typeof LEAD_SCORING_FIELDS)[number];

export const LEAD_SCORING_OPERATORS = ["equals", "in", "greaterThan", "lessThan", "isBusinessEmail"] as const;
export type LeadScoringOperator = (typeof LEAD_SCORING_OPERATORS)[number];

export interface LeadDto {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  campaign: string | null;
  ownerId: string | null;
  status: LeadStatus;
  score: number;
  industry: string | null;
  location: string | null;
  estimatedValue: number | null;
  currency: string | null;
  notes: string | null;
  tags: string[];
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadScoringRuleDto {
  id: string;
  organizationId: string;
  name: string;
  field: LeadScoringField;
  operator: LeadScoringOperator;
  value: string | number | string[] | null;
  points: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadSourceStatDto {
  source: LeadSource;
  count: number;
}

export interface ConvertLeadResultDto {
  lead: LeadDto;
  account: { id: string; name: string };
  contact: { id: string; firstName: string; lastName: string };
  opportunity: { id: string; name: string; stageId: string };
  reusedExistingAccount: boolean;
  reusedExistingContact: boolean;
}

export const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.enum(LEAD_SOURCES),
  campaign: z.string().trim().max(200).optional(),
  ownerId: z.string().uuid().optional(),
  industry: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  estimatedValue: z.number().nonnegative().optional(),
  currency: z.string().trim().max(10).optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

// Excludes `status` on purpose — status only changes via /qualify or /convert,
// so it stays out of the generic edit surface (see assertValidLeadTransition).
export const updateLeadSchema = createLeadSchema.partial();
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const qualifyLeadSchema = z.object({
  outcome: z.enum(["qualified", "unqualified"]),
});
export type QualifyLeadInput = z.infer<typeof qualifyLeadSchema>;

const scoringRuleValueSchema = z.union([z.string(), z.number(), z.array(z.string())]).optional();

const scoringRuleShape = {
  name: z.string().trim().min(1).max(120),
  field: z.enum(LEAD_SCORING_FIELDS),
  operator: z.enum(LEAD_SCORING_OPERATORS),
  value: scoringRuleValueSchema,
  points: z.number().int(),
  active: z.boolean().default(true),
};

export const createScoringRuleSchema = z
  .object(scoringRuleShape)
  .refine((input) => input.operator === "isBusinessEmail" || input.value !== undefined, {
    message: "value is required unless operator is isBusinessEmail",
    path: ["value"],
  });
export type CreateScoringRuleInput = z.infer<typeof createScoringRuleSchema>;

export const updateScoringRuleSchema = z.object(scoringRuleShape).partial();
export type UpdateScoringRuleInput = z.infer<typeof updateScoringRuleSchema>;
