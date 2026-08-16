"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAcceptPublicQuote, usePublicQuote, useRejectPublicQuote } from "@/hooks/use-public-quote";
import { ApiError } from "@/lib/http";

export default function PublicQuotePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { data, isLoading, error: loadError } = usePublicQuote(token);
  const accept = useAcceptPublicQuote();
  const reject = useRejectPublicQuote();
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6 md:p-10">
      {isLoading && <p className="text-sm text-muted-foreground">Loading quote...</p>}
      {loadError && <p className="text-sm text-destructive">This quote link is invalid or no longer available.</p>}

      {data && (
        <>
          <div>
            <p className="text-sm text-muted-foreground">{data.organizationName}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Quote {data.quote.quoteNumber}</h1>
            <p className="text-sm text-muted-foreground">
              For {data.accountName} · <span className="capitalize">{data.quote.status}</span>
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 font-medium">Item</th>
                    <th className="py-2 font-medium">Qty</th>
                    <th className="py-2 font-medium">Unit price</th>
                    <th className="py-2 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.version.lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-2">{item.name}</td>
                      <td className="py-2">{item.quantity}</td>
                      <td className="py-2">{item.unitPrice.toLocaleString()}</td>
                      <td className="py-2 text-right">{item.lineTotal.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-col items-end gap-1 text-sm">
                <p>
                  Subtotal: {data.quote.currency} {data.quote.subtotal.toLocaleString()}
                </p>
                <p>
                  Discount: -{data.quote.currency} {data.quote.discountTotal.toLocaleString()}
                </p>
                <p>
                  Tax: {data.quote.currency} {data.quote.taxTotal.toLocaleString()}
                </p>
                <p className="text-base font-semibold">
                  Total: {data.quote.currency} {data.quote.total.toLocaleString()}
                </p>
              </div>
              {data.quote.notes && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{data.quote.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/gateway/public/quotes/${token}/pdf`} target="_blank" rel="noreferrer">
              <Button variant="outline">Download PDF</Button>
            </a>
            {data.quote.status === "sent" && (
              <>
                <Button onClick={() => runAction(() => accept.mutateAsync(token), "Failed to accept quote")}>Accept quote</Button>
                <Button variant="outline" onClick={() => runAction(() => reject.mutateAsync(token), "Failed to reject quote")}>
                  Reject quote
                </Button>
              </>
            )}
            {data.quote.status === "accepted" && <p className="text-sm text-muted-foreground">You accepted this quote.</p>}
            {data.quote.status === "rejected" && <p className="text-sm text-muted-foreground">You rejected this quote.</p>}
            {data.quote.status === "expired" && <p className="text-sm text-muted-foreground">This quote has expired.</p>}
          </div>
        </>
      )}
    </main>
  );
}
