"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { QuoteForm } from "@/components/quotes/quote-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import {
  useDeleteQuote,
  useQuote,
  useQuoteVersions,
  useReviseQuote,
  useSendQuote,
  useUpdateQuote,
} from "@/hooks/use-quotes";
import { ApiError } from "@/lib/http";
import type { CreateQuoteInput } from "@sales-platform/contracts";

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: detail, isLoading } = useQuote(id);
  const { data: accounts } = useAccounts();
  const { data: versions } = useQuoteVersions(id);
  const updateQuote = useUpdateQuote();
  const deleteQuote = useDeleteQuote();
  const sendQuote = useSendQuote();
  const reviseQuote = useReviseQuote();

  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canEdit = currentUser?.permissions.includes("quotes.edit");
  const canDelete = currentUser?.permissions.includes("quotes.delete");
  const canSend = currentUser?.permissions.includes("quotes.send");

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  const onUpdate = async (input: CreateQuoteInput) => {
    if (!detail) return;
    setError(null);
    try {
      await updateQuote.mutateAsync({
        id: detail.quote.id,
        input: {
          contactId: input.contactId,
          opportunityId: input.opportunityId,
          currency: input.currency,
          validUntil: input.validUntil,
          notes: input.notes,
          lineItems: input.lineItems,
        },
      });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update quote");
    }
  };

  const onDelete = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete quote ${detail.quote.quoteNumber}? This cannot be undone.`)) return;
    await deleteQuote.mutateAsync(detail.quote.id);
    router.push("/quotes");
  };

  const copyPublicLink = async () => {
    if (!detail?.quote.shareToken) return;
    const url = `${window.location.origin}/public/quotes/${detail.quote.shareToken}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">Quote not found.</p>;

  const { quote, version } = detail;
  const account = accounts?.find((a) => a.id === quote.accountId);
  const canReviseFrom = ["sent", "rejected", "expired"].includes(quote.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/quotes" className="text-sm text-muted-foreground hover:underline">
            ← Quotes
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{quote.quoteNumber}</h1>
          {account && (
            <Link href={`/crm/accounts/${account.id}`} className="text-sm text-muted-foreground hover:underline">
              {account.name}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/gateway/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">Download PDF</Button>
          </a>
          {quote.shareToken && (
            <Button variant="outline" onClick={copyPublicLink}>
              {copied ? "Copied!" : "Copy public link"}
            </Button>
          )}
          {canSend && quote.status === "draft" && (
            <Button onClick={() => runAction(() => sendQuote.mutateAsync(quote.id), "Failed to send quote")}>Send</Button>
          )}
          {canEdit && canReviseFrom && (
            <Button variant="outline" onClick={() => runAction(() => reviseQuote.mutateAsync(quote.id), "Failed to revise quote")}>
              Revise
            </Button>
          )}
          {canEdit && quote.status === "draft" && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && quote.status === "draft" && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base capitalize">Status: {quote.status}</CardTitle>
          <span className="text-xs text-muted-foreground">Version {quote.currentVersion}</span>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Valid until</p>
            <p>{quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sent</p>
            <p>{quote.sentAt ? new Date(quote.sentAt).toLocaleString() : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Accepted</p>
            <p>{quote.acceptedAt ? new Date(quote.acceptedAt).toLocaleString() : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Rejected</p>
            <p>{quote.rejectedAt ? new Date(quote.rejectedAt).toLocaleString() : "—"}</p>
          </div>
        </CardContent>
      </Card>

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
                <th className="py-2 font-medium">Disc %</th>
                <th className="py-2 font-medium">Tax %</th>
                <th className="py-2 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {version.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="py-2">{item.name}</td>
                  <td className="py-2">{item.quantity}</td>
                  <td className="py-2">{item.unitPrice.toLocaleString()}</td>
                  <td className="py-2">{item.discountPercent}%</td>
                  <td className="py-2">{item.taxPercent}%</td>
                  <td className="py-2 text-right">{item.lineTotal.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <p>
              Subtotal: {quote.currency} {quote.subtotal.toLocaleString()}
            </p>
            <p>
              Discount: -{quote.currency} {quote.discountTotal.toLocaleString()}
            </p>
            <p>
              Tax: {quote.currency} {quote.taxTotal.toLocaleString()}
            </p>
            <p className="text-base font-semibold">
              Total: {quote.currency} {quote.total.toLocaleString()}
            </p>
          </div>
          {quote.notes && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-muted-foreground">Notes</p>
              <p className="whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {versions && versions.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <span>
                    Version {v.versionNumber} — {v.currency} {v.total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                    <a href={`/api/gateway/quotes/${quote.id}/versions/${v.versionNumber}/pdf`} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm">
                        PDF
                      </Button>
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No version history yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit quote" className="max-w-3xl">
        <QuoteForm
          initialQuote={quote}
          initialVersion={version}
          onSubmit={onUpdate}
          submitLabel="Save changes"
          isPending={updateQuote.isPending}
        />
      </Dialog>
    </div>
  );
}
