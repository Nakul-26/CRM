import { z } from "zod";

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ["active", "lapsed", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  price: number;
  billingInterval: BillingInterval;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDto {
  id: string;
  organizationId: string;
  accountId: string;
  contactId: string | null;
  planId: string | null;
  planName: string;
  price: number;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  /** Whether a reminder for the current period has already been dispatched. */
  currentPeriodReminderSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  price: z.number().nonnegative(),
  billingInterval: z.enum(BILLING_INTERVALS).default("monthly"),
  isActive: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema.partial();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const createSubscriptionSchema = z.object({
  accountId: z.string().uuid(),
  planId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  currentPeriodStart: z.string().datetime().optional(),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

// The plan/price/billing-interval snapshot and period dates only change via
// the explicit renew/cancel actions, never a raw PATCH — see
// docs/decisions/0007-subscriptions-phase7-scope.md. Only the contact to
// notify can be reassigned this way.
export const updateSubscriptionSchema = z.object({
  contactId: z.string().uuid().nullable().optional(),
});
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
