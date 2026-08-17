"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { PlanForm } from "@/components/subscriptions/plan-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreatePlan, useDeletePlan, usePlans } from "@/hooks/use-plans";
import { ApiError } from "@/lib/http";
import type { CreatePlanInput } from "@sales-platform/contracts";

export default function PlansPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: plans, isLoading } = usePlans();
  const create = useCreatePlan();
  const deletePlan = useDeletePlan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = currentUser?.permissions.includes("subscriptions.manage");

  const onCreate = async (input: CreatePlanInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create plan");
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete plan "${name}"?`)) return;
    setError(null);
    try {
      await deletePlan.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to delete plan");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground">Subscription plans customers can be enrolled in.</p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)}>New Plan</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All plans</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : plans && plans.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {plans.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div>
                    <p className="font-medium">
                      {p.name} {!p.isActive && <span className="text-muted-foreground">(inactive)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.price}/{p.billingInterval}
                      {p.description ? ` · ${p.description}` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <Button variant="outline" size="sm" onClick={() => onDelete(p.id, p.name)}>
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No plans yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New plan">
        <PlanForm onSubmit={onCreate} isPending={create.isPending} />
      </Dialog>
    </div>
  );
}
