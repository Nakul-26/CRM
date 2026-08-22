"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompleteMockPayment, useFailMockPayment, useMockPayment } from "@/hooks/use-payments";
import { ApiError } from "@/lib/http";

/**
 * Stands in for an external hosted checkout page (a real Stripe Checkout
 * session would be on stripe.com, not this app) — unauthenticated, scoped
 * only by the payment's own id, same trust model as a quote's shareToken.
 * See docs/decisions/0013-payment-processing-phase13-scope.md.
 */
export default function MockCheckoutPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = params.paymentId;
  const router = useRouter();
  const { data, isLoading, error: loadError } = useMockPayment(paymentId);
  const complete = useCompleteMockPayment();
  const fail = useFailMockPayment();
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<unknown>, redirectTo: string, message: string) => {
    setError(null);
    try {
      await action();
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      {isLoading && <p className="text-sm text-muted-foreground">Loading checkout...</p>}
      {loadError && <p className="text-sm text-destructive">This checkout link is invalid or no longer available.</p>}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mock checkout</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              This is a simulated payment page — no real gateway or account is involved. See{" "}
              <code>PAYMENT_PROVIDER</code> to switch to real Stripe checkout.
            </p>
            <div>
              <p className="text-sm text-muted-foreground">{data.description}</p>
              <p className="text-2xl font-semibold tracking-tight">
                {data.currency.toUpperCase()} {data.amount.toLocaleString()}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {data.status === "pending" && (
              <div className="flex gap-2">
                <Button onClick={() => runAction(() => complete.mutateAsync(paymentId), "/subscriptions?payment=success", "Failed to complete payment")}>
                  Pay now
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runAction(() => fail.mutateAsync(paymentId), "/subscriptions?payment=cancelled", "Failed to cancel payment")}
                >
                  Cancel
                </Button>
              </div>
            )}
            {data.status === "succeeded" && <p className="text-sm text-muted-foreground">This payment already succeeded.</p>}
            {data.status === "failed" && <p className="text-sm text-muted-foreground">This payment already failed.</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
