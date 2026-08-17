"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { TicketForm } from "@/components/support/ticket-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useCreateTicket, useTickets } from "@/hooks/use-tickets";
import { ApiError } from "@/lib/http";
import { TICKET_STATUSES, type CreateTicketInput, type TicketDto } from "@sales-platform/contracts";

export default function TicketsPage() {
  const { data: currentUser } = useCurrentUser();
  const [status, setStatus] = useState<string>("");
  const { data: tickets, isLoading } = useTickets({ status: (status || undefined) as never });
  const { data: accounts } = useAccounts();
  const create = useCreateTicket();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("support.tickets.create");
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const onCreate = async (input: CreateTicketInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create ticket");
    }
  };

  const columns: DataTableColumn<TicketDto>[] = [
    {
      header: "Subject",
      cell: (t) => (
        <Link href={`/support/tickets/${t.id}`} className="font-medium hover:underline">
          {t.subject}
        </Link>
      ),
    },
    { header: "Account", cell: (t) => accountName(t.accountId) },
    { header: "Status", cell: (t) => <span className="capitalize">{t.status.replace("_", " ")}</span> },
    { header: "Priority", cell: (t) => <span className="capitalize">{t.priority}</span> },
    {
      header: "SLA",
      cell: (t) =>
        t.firstResponseBreached || t.resolutionBreached ? (
          <span className="text-destructive">Breached</span>
        ) : t.resolutionDueAt ? (
          "On track"
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">Customer support requests.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Ticket</Button>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All tickets</CardTitle>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={tickets} isLoading={isLoading} emptyMessage="No tickets yet." rowKey={(t) => t.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New ticket" className="max-w-2xl">
        <TicketForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
