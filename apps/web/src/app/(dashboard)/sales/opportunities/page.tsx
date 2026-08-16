"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { OpportunityForm } from "@/components/sales/opportunity-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useCreateOpportunity, useOpportunities } from "@/hooks/use-opportunities";
import { usePipelineStages, usePipelines } from "@/hooks/use-pipelines";
import { ApiError } from "@/lib/http";
import { OPPORTUNITY_OUTCOMES, type CreateOpportunityInput, type OpportunityDto } from "@sales-platform/contracts";

export default function OpportunitiesPage() {
  const { data: currentUser } = useCurrentUser();
  const [outcome, setOutcome] = useState<string>("");
  const { data: opportunities, isLoading } = useOpportunities({ outcome: outcome || undefined });
  const { data: accounts } = useAccounts();
  const { data: pipelines } = usePipelines();
  const { data: stages } = usePipelineStages(pipelines?.[0]?.id);
  const create = useCreateOpportunity();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("opportunities.create");

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";
  const stageName = (id: string) => stages?.find((s) => s.id === id)?.name ?? "—";

  const onCreate = async (input: CreateOpportunityInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create opportunity");
    }
  };

  const columns: DataTableColumn<OpportunityDto>[] = [
    {
      header: "Name",
      cell: (o) => (
        <Link href={`/sales/opportunities/${o.id}`} className="font-medium hover:underline">
          {o.name}
        </Link>
      ),
    },
    { header: "Account", cell: (o) => accountName(o.accountId) },
    { header: "Stage", cell: (o) => stageName(o.stageId) },
    { header: "Value", cell: (o) => (o.value != null ? `${o.currency ?? ""} ${o.value.toLocaleString()}`.trim() : "—") },
    { header: "Probability", cell: (o) => `${o.probability}%` },
    { header: "Outcome", cell: (o) => o.outcome },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Opportunities</h1>
          <p className="text-sm text-muted-foreground">Deals in progress, from qualification through close.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Opportunity</Button>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All opportunities</CardTitle>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All outcomes</option>
            {OPPORTUNITY_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={opportunities} isLoading={isLoading} emptyMessage="No opportunities yet." rowKey={(o) => o.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New opportunity">
        <OpportunityForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
