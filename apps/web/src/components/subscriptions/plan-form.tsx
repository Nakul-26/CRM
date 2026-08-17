"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BILLING_INTERVALS, type CreatePlanInput, type PlanDto } from "@sales-platform/contracts";

export function PlanForm({
  initialPlan,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initialPlan?: PlanDto;
  onSubmit: (input: CreatePlanInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const [name, setName] = useState(initialPlan?.name ?? "");
  const [description, setDescription] = useState(initialPlan?.description ?? "");
  const [price, setPrice] = useState(initialPlan?.price ?? 0);
  const [billingInterval, setBillingInterval] = useState(initialPlan?.billingInterval ?? "monthly");
  const [isActive, setIsActive] = useState(initialPlan?.isActive ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ name, description: description || undefined, price, billingInterval: billingInterval as never, isActive });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-name">Name</Label>
        <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-price">Price</Label>
          <Input id="plan-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-interval">Billing interval</Label>
          <select
            id="plan-interval"
            value={billingInterval}
            onChange={(e) => setBillingInterval(e.target.value as never)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {BILLING_INTERVALS.map((interval) => (
              <option key={interval} value={interval}>
                {interval}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-description">Description</Label>
        <textarea
          id="plan-description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
