"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { QuoteForm } from "@/components/quotes/quote-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useCreateQuote, useQuotes } from "@/hooks/use-quotes";
import { ApiError } from "@/lib/http";
import { QUOTE_STATUSES, type CreateQuoteInput, type QuoteDto } from "@sales-platform/contracts";

export default function QuotesPage() {
  const { data: currentUser } = useCurrentUser();
  const [status, setStatus] = useState<string>("");
  const { data: quotes, isLoading } = useQuotes({ status: (status || undefined) as never });
  const { data: accounts } = useAccounts();
  const create = useCreateQuote();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("quotes.create");
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const onCreate = async (input: CreateQuoteInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create quote");
    }
  };

  const columns: DataTableColumn<QuoteDto>[] = [
    {
      header: "Quote #",
      cell: (q) => (
        <Link href={`/quotes/${q.id}`} className="font-medium hover:underline">
          {q.quoteNumber}
        </Link>
      ),
    },
    { header: "Account", cell: (q) => accountName(q.accountId) },
    { header: "Status", cell: (q) => <span className="capitalize">{q.status}</span> },
    { header: "Total", cell: (q) => `${q.currency} ${q.total.toLocaleString()}` },
    { header: "Valid until", cell: (q) => (q.validUntil ? new Date(q.validUntil).toLocaleDateString() : "—") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground">Proposals sent to prospects and customers.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Quote</Button>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All quotes</CardTitle>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={quotes} isLoading={isLoading} emptyMessage="No quotes yet." rowKey={(q) => q.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New quote" className="max-w-3xl">
        <QuoteForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
