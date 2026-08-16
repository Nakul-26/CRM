"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { LeadForm } from "@/components/leads/lead-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateLead, useLeads } from "@/hooks/use-leads";
import { ApiError } from "@/lib/http";
import { LEAD_STATUSES, type CreateLeadInput, type LeadDto } from "@sales-platform/contracts";

export default function LeadsPage() {
  const { data: currentUser } = useCurrentUser();
  const [status, setStatus] = useState<string>("");
  const { data: leads, isLoading } = useLeads(status || undefined);
  const create = useCreateLead();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("leads.create");

  const onCreate = async (input: CreateLeadInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create lead");
    }
  };

  const columns: DataTableColumn<LeadDto>[] = [
    {
      header: "Name",
      cell: (l) => (
        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
          {l.name}
        </Link>
      ),
    },
    { header: "Company", cell: (l) => l.company ?? "—" },
    { header: "Source", cell: (l) => l.source.replace("_", " ") },
    { header: "Status", cell: (l) => l.status },
    { header: "Score", cell: (l) => l.score },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">Inbound and outbound leads, from first contact to conversion.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Lead</Button>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All leads</CardTitle>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={leads} isLoading={isLoading} emptyMessage="No leads yet." rowKey={(l) => l.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New lead">
        <LeadForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
