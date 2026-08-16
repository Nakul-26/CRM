"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useMoveOpportunityStage, useOpportunities } from "@/hooks/use-opportunities";
import { useCreateStage, useDeleteStage, usePipelineStages, usePipelines } from "@/hooks/use-pipelines";
import { ApiError } from "@/lib/http";
import type { OpportunityDto, StageDto } from "@sales-platform/contracts";

export default function PipelinePage() {
  const { data: currentUser } = useCurrentUser();
  const { data: pipelines, isLoading: pipelinesLoading } = usePipelines();
  const [pipelineId, setPipelineId] = useState<string>("");
  const activePipelineId = pipelineId || pipelines?.[0]?.id;

  const { data: stages } = usePipelineStages(activePipelineId);
  const { data: opportunities } = useOpportunities({ pipelineId: activePipelineId, outcome: "open" });
  const { data: accounts } = useAccounts();
  const moveStage = useMoveOpportunityStage();

  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const canManage = currentUser?.permissions.includes("opportunities.pipelines.manage");
  const orderedStages = stages ? [...stages].sort((a, b) => a.order - b.order) : [];
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const onDrop = async (stage: StageDto) => {
    if (!draggingId) return;
    const opportunity = opportunities?.find((o) => o.id === draggingId);
    setDraggingId(null);
    if (!opportunity || opportunity.stageId === stage.id) return;
    setError(null);
    try {
      await moveStage.mutateAsync({ id: opportunity.id, input: { stageId: stage.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to move opportunity");
    }
  };

  if (pipelinesLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground">Drag a card to move it between stages.</p>
        </div>
        <div className="flex items-center gap-2">
          {pipelines && pipelines.length > 1 && (
            <select
              value={activePipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {canManage && (
            <Button variant="outline" onClick={() => setManageOpen(true)}>
              Manage Stages
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {orderedStages.map((stage) => {
          const cards = opportunities?.filter((o) => o.stageId === stage.id) ?? [];
          return (
            <div
              key={stage.id}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={() => onDrop(stage)}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{stage.name}</h3>
                <span className="text-xs text-muted-foreground">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {cards.map((o: OpportunityDto) => (
                  <div
                    key={o.id}
                    draggable
                    onDragStart={() => setDraggingId(o.id)}
                    onDragEnd={() => setDraggingId(null)}
                    className="cursor-grab rounded-md border border-border bg-card p-3 text-sm shadow-sm active:cursor-grabbing"
                  >
                    <Link href={`/sales/opportunities/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{accountName(o.accountId)}</p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span>{o.value != null ? `${o.currency ?? ""} ${o.value.toLocaleString()}`.trim() : "—"}</span>
                      <span className="text-muted-foreground">{o.probability}%</span>
                    </div>
                  </div>
                ))}
                {cards.length === 0 && <p className="text-xs text-muted-foreground">No opportunities</p>}
              </div>
            </div>
          );
        })}
        {orderedStages.length === 0 && <p className="text-sm text-muted-foreground">No stages configured for this pipeline.</p>}
      </div>

      {activePipelineId && (
        <ManageStagesDialog open={manageOpen} onOpenChange={setManageOpen} pipelineId={activePipelineId} stages={orderedStages} />
      )}
    </div>
  );
}

function ManageStagesDialog({
  open,
  onOpenChange,
  pipelineId,
  stages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stages: StageDto[];
}) {
  const createStage = useCreateStage();
  const deleteStage = useDeleteStage();
  const [name, setName] = useState("");
  const [order, setOrder] = useState(String((stages.at(-1)?.order ?? 0) + 1));
  const [probability, setProbability] = useState("0");
  const [isWon, setIsWon] = useState(false);
  const [isLost, setIsLost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createStage.mutateAsync({
        pipelineId,
        input: { name, order: Number(order), probability: Number(probability), isWon, isLost },
      });
      setName("");
      setIsWon(false);
      setIsLost(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create stage");
    }
  };

  const onDelete = async (stageId: string) => {
    setError(null);
    try {
      await deleteStage.mutateAsync({ pipelineId, stageId });
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to delete stage");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Manage stages">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm">
          {stages.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
              <span>
                {s.order}. {s.name} ({s.probability}%){s.isWon && " · Won"}
                {s.isLost && " · Lost"}
              </span>
              <Button variant="outline" size="sm" onClick={() => onDelete(s.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={onCreate} className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stage-name">Name</Label>
              <Input id="stage-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stage-order">Order</Label>
              <Input id="stage-order" type="number" value={order} onChange={(e) => setOrder(e.target.value)} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stage-probability">Probability (%)</Label>
            <Input id="stage-probability" type="number" min="0" max="100" value={probability} onChange={(e) => setProbability(e.target.value)} />
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={isWon} onChange={(e) => setIsWon(e.target.checked)} />
              Won stage
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={isLost} onChange={(e) => setIsLost(e.target.checked)} />
              Lost stage
            </label>
          </div>
          <Button type="submit" disabled={createStage.isPending} className="self-start">
            {createStage.isPending ? "Saving..." : "Add stage"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </div>
    </Dialog>
  );
}
