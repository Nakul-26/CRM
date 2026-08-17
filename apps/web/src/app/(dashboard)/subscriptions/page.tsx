"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useCancelSubscription, useCreateSubscription, useRenewSubscription, useSubscriptions } from "@/hooks/use-subscriptions";
import { ApiError } from "@/lib/http";
import { SUBSCRIPTION_STATUSES, type CreateSubscriptionInput, type SubscriptionDto } from "@sales-platform/contracts";

export default function SubscriptionsPage() {
  const { data: currentUser } = useCurrentUser();
  const [status, setStatus] = useState<string>("");
  const { data: subscriptions, isLoading } = useSubscriptions({ status: (status || undefined) as never });
  const { data: accounts } = useAccounts();
  const create = useCreateSubscription();
  const cancel = useCancelSubscription();
  const renew = useRenewSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("subscriptions.create");
  const canEdit = currentUser?.permissions.includes("subscriptions.edit");
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const onCreate = async (input: CreateSubscriptionInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create subscription");
    }
  };

  const onCancel = async (id: string) => {
    if (!window.confirm("Cancel this subscription?")) return;
    setError(null);
    try {
      await cancel.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to cancel subscription");
    }
  };

  const onRenew = async (id: string) => {
    setError(null);
    try {
      await renew.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to renew subscription");
    }
  };

  const columns: DataTableColumn<SubscriptionDto>[] = [
    { header: "Plan", cell: (s) => <span className="font-medium">{s.planName}</span> },
    { header: "Account", cell: (s) => accountName(s.accountId) },
    { header: "Price", cell: (s) => `${s.price}/${s.billingInterval}` },
    { header: "Status", cell: (s) => <span className="capitalize">{s.status}</span> },
    { header: "Renews", cell: (s) => new Date(s.currentPeriodEnd).toLocaleDateString() },
    {
      header: "",
      cell: (s) =>
        canEdit && s.status !== "cancelled" ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onRenew(s.id)}>
              Renew
            </Button>
            <Button variant="outline" size="sm" onClick={() => onCancel(s.id)}>
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Active and past customer subscriptions.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Subscription</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">All subscriptions</CardTitle>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All statuses</option>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          <DataTable data={subscriptions} isLoading={isLoading} emptyMessage="No subscriptions yet." rowKey={(s) => s.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New subscription" className="max-w-2xl">
        <SubscriptionForm onSubmit={onCreate} isPending={create.isPending} />
      </Dialog>
    </div>
  );
}
