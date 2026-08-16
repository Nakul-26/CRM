import { z } from "zod";
import { LEAD_SOURCES, type LeadSource } from "./leads";

export const OPPORTUNITY_OUTCOMES = ["open", "won", "lost"] as const;
export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];

/** Same channel list as Lead Sources — where a deal originated. */
export const OPPORTUNITY_SOURCES = LEAD_SOURCES;
export type OpportunitySource = LeadSource;

export interface PipelineDto {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StageDto {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityDto {
  id: string;
  organizationId: string;
  name: string;
  accountId: string;
  contactId: string | null;
  ownerId: string | null;
  pipelineId: string;
  stageId: string;
  outcome: OpportunityOutcome;
  value: number | null;
  currency: string | null;
  probability: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  source: OpportunitySource | null;
  competitors: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityStageHistoryEntryDto {
  id: string;
  opportunityId: string;
  fromStageId: string | null;
  toStageId: string;
  actorId?: string;
  occurredAt: string;
}

export interface OpportunitySummaryStatsDto {
  openCount: number;
  wonCount: number;
  lostCount: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
  wonRevenue: number;
  lostRevenue: number;
  winRate: number;
  averageDealSize: number;
  averageSalesCycleDays: number;
  salesVelocity: number;
}

export interface OpportunityForecastPointDto {
  month: string; // "YYYY-MM"
  value: number;
  weightedValue: number;
  count: number;
}

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(false),
});
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = createPipelineSchema.partial();
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;

export const createStageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  order: z.number().int(),
  probability: z.number().int().min(0).max(100).default(0),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

export const updateStageSchema = createStageSchema.partial();
export type UpdateStageInput = z.infer<typeof updateStageSchema>;

export const createOpportunitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  // Defaulted server-side (org's default pipeline / its first stage) when omitted.
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().trim().max(10).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  source: z.enum(OPPORTUNITY_SOURCES).optional(),
  competitors: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().max(5000).optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

// Excludes accountId/pipelineId/stageId on purpose — the account and
// pipeline are fixed at creation, and stage only changes via the dedicated
// /stage action (see OpportunitiesService.moveStage), same precedent as
// Leads excluding `status` from its generic PATCH surface.
export const updateOpportunitySchema = createOpportunitySchema
  .omit({ accountId: true, pipelineId: true, stageId: true })
  .partial();
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const moveOpportunityStageSchema = z.object({
  stageId: z.string().uuid(),
  probability: z.number().int().min(0).max(100).optional(),
});
export type MoveOpportunityStageInput = z.infer<typeof moveOpportunityStageSchema>;
