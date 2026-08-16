"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { OpportunityForm } from "@/components/sales/opportunity-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import {
  useDeleteOpportunity,
  useMoveOpportunityStage,
  useOpportunity,
  useOpportunityStageHistory,
  useUpdateOpportunity,
} from "@/hooks/use-opportunities";
import { usePipelineStages, usePipelines } from "@/hooks/use-pipelines";
import { ApiError } from "@/lib/http";
import type { UpdateOpportunityInput } from "@sales-platform/contracts";

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: opportunity, isLoading } = useOpportunity(id);
  const { data: accounts } = useAccounts();
  const { data: pipelines } = usePipelines();
  const { data: stages } = usePipelineStages(opportunity?.pipelineId);
  const { data: history } = useOpportunityStageHistory(id);
  const updateOpportunity = useUpdateOpportunity();
  const deleteOpportunity = useDeleteOpportunity();
  const moveStage = useMoveOpportunityStage();

  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = currentUser?.permissions.includes("opportunities.edit");
  const canDelete = currentUser?.permissions.includes("opportunities.delete");

  const account = accounts?.find((a) => a.id === opportunity?.accountId);
  const currentStage = stages?.find((s) => s.id === opportunity?.stageId);
  const orderedStages = stages ? [...stages].sort((a, b) => a.order - b.order) : [];

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  const onUpdate = async (input: UpdateOpportunityInput) => {
    if (!opportunity) return;
    setError(null);
    try {
      await updateOpportunity.mutateAsync({ id: opportunity.id, input });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update opportunity");
    }
  };

  const onDelete = async () => {
    if (!opportunity) return;
    if (!window.confirm(`Delete opportunity "${opportunity.name}"? This cannot be undone.`)) return;
    await deleteOpportunity.mutateAsync(opportunity.id);
    router.push("/sales/opportunities");
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!opportunity) return <p className="text-sm text-muted-foreground">Opportunity not found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/sales/opportunities" className="text-sm text-muted-foreground hover:underline">
            ← Opportunities
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{opportunity.name}</h1>
          {account && (
            <Link href={`/crm/accounts/${account.id}`} className="text-sm text-muted-foreground hover:underline">
              {account.name}
            </Link>
          )}
        </div>
        <div className="flex gap-2">
          {canEdit && opportunity.outcome === "open" && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Stage: {currentStage?.name ?? "—"}</CardTitle>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">{opportunity.outcome}</span>
            <span className="text-xs text-muted-foreground">Probability: {opportunity.probability}%</span>
          </div>
        </CardHeader>
        {canEdit && opportunity.outcome === "open" && (
          <CardContent className="flex flex-wrap gap-2">
            {orderedStages
              .filter((s) => s.id !== opportunity.stageId)
              .map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={s.isWon || s.isLost ? "outline" : "default"}
                  onClick={() => runAction(() => moveStage.mutateAsync({ id: opportunity.id, input: { stageId: s.id } }), "Failed to move stage")}
                >
                  Move to {s.name}
                </Button>
              ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Value</p>
            <p>{opportunity.value != null ? `${opportunity.currency ?? ""} ${opportunity.value.toLocaleString()}`.trim() : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pipeline</p>
            <p>{pipelines?.find((p) => p.id === opportunity.pipelineId)?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Expected close date</p>
            <p>{opportunity.expectedCloseDate ? new Date(opportunity.expectedCloseDate).toLocaleDateString() : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Source</p>
            <p>{opportunity.source?.replace("_", " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Competitors</p>
            <p>{opportunity.competitors.length ? opportunity.competitors.join(", ") : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Closed at</p>
            <p>{opportunity.closedAt ? new Date(opportunity.closedAt).toLocaleString() : "—"}</p>
          </div>
          {opportunity.notes && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Notes</p>
              <p className="whitespace-pre-wrap">{opportunity.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage history</CardTitle>
        </CardHeader>
        <CardContent>
          {history && history.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between border-b border-border pb-2 last:border-0">
                  <span>
                    {h.fromStageId ? stages?.find((s) => s.id === h.fromStageId)?.name ?? "—" : "—"} →{" "}
                    {stages?.find((s) => s.id === h.toStageId)?.name ?? "—"}
                  </span>
                  <span className="text-muted-foreground">{new Date(h.occurredAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No stage changes yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit opportunity">
        <OpportunityForm initial={opportunity} onSubmit={onUpdate} submitLabel="Save changes" isPending={updateOpportunity.isPending} />
      </Dialog>
    </div>
  );
}
