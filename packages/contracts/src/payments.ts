import { z } from "zod";

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["mock", "stripe"] as const;
export type PaymentProviderKind = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentDto {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProviderKind;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Curated subset returned by the public, payment-id-scoped mock checkout view — no organizationId/account data. */
export interface MockPaymentViewDto {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  description: string;
}

export interface CheckoutSessionDto {
  paymentId: string;
  checkoutUrl: string;
}

export const startCheckoutSchema = z.object({
  subscriptionId: z.string().uuid(),
});
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;
