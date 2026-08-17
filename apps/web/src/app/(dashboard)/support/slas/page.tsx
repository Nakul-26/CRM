"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SlaPolicyForm } from "@/components/support/sla-policy-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateSlaPolicy, useDeleteSlaPolicy, useSlaPolicies } from "@/hooks/use-sla-policies";
import { ApiError } from "@/lib/http";
import type { CreateSlaPolicyInput } from "@sales-platform/contracts";

export default function SlaPoliciesPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: policies, isLoading } = useSlaPolicies();
  const create = useCreateSlaPolicy();
  const deletePolicy = useDeleteSlaPolicy();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = currentUser?.permissions.includes("support.sla_policies.manage");

  const onCreate = async (input: CreateSlaPolicyInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create SLA policy");
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete SLA policy "${name}"?`)) return;
    setError(null);
    try {
      await deletePolicy.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to delete SLA policy");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SLA Policies</h1>
          <p className="text-sm text-muted-foreground">Response and resolution targets by ticket priority.</p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)}>New Policy</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All policies</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : policies && policies.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {policies.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div>
                    <p className="font-medium capitalize">
                      {p.name} <span className="text-muted-foreground">({p.priority})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      First response: {p.firstResponseTargetMinutes}m · Resolution: {p.resolutionTargetMinutes}m
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
            <p className="text-sm text-muted-foreground">No SLA policies yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New SLA policy">
        <SlaPolicyForm onSubmit={onCreate} isPending={create.isPending} />
      </Dialog>
    </div>
  );
}
