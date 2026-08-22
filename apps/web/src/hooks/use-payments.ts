"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckoutSessionDto, MockPaymentViewDto, PaymentDto } from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export function useSubscriptionPayments(subscriptionId: string | undefined) {
  return useQuery<PaymentDto[]>({
    queryKey: ["payments", "subscription", subscriptionId],
    queryFn: () => apiFetch<PaymentDto[]>(`payments/subscriptions/${subscriptionId}`),
    enabled: Boolean(subscriptionId),
  });
}

export function useStartCheckout() {
  return useMutation({
    mutationFn: (subscriptionId: string) =>
      apiFetch<CheckoutSessionDto>("payments/checkout", { method: "POST", body: JSON.stringify({ subscriptionId }) }),
  });
}

export function useMockPayment(paymentId: string | undefined) {
  return useQuery<MockPaymentViewDto>({
    queryKey: ["mock-payment", paymentId],
    queryFn: () => apiFetch<MockPaymentViewDto>(`payments/mock/${paymentId}`),
    enabled: Boolean(paymentId),
    retry: false,
  });
}

export function useCompleteMockPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => apiFetch<void>(`payments/mock/${paymentId}/complete`, { method: "POST" }),
    onSuccess: (_data, paymentId) => queryClient.invalidateQueries({ queryKey: ["mock-payment", paymentId] }),
  });
}

export function useFailMockPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => apiFetch<void>(`payments/mock/${paymentId}/fail`, { method: "POST" }),
    onSuccess: (_data, paymentId) => queryClient.invalidateQueries({ queryKey: ["mock-payment", paymentId] }),
  });
}
