"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts } from "@/hooks/use-contacts";
import { usePlans } from "@/hooks/use-plans";
import type { CreateSubscriptionInput } from "@sales-platform/contracts";

export function SubscriptionForm({
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  onSubmit: (input: CreateSubscriptionInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const { data: accounts } = useAccounts();
  const { data: plans } = usePlans();

  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");
  const { data: contacts } = useContacts(accountId || undefined);
  const [planId, setPlanId] = useState("");

  const activePlans = plans?.filter((p) => p.isActive) ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ accountId, planId, contactId: contactId || undefined });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subscription-account">Account</Label>
          <select
            id="subscription-account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setContactId("");
            }}
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>
              Select an account
            </option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subscription-contact">Contact</Label>
          <select
            id="subscription-contact"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            disabled={!accountId}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            <option value="">None</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subscription-plan">Plan</Label>
        <select
          id="subscription-plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>
            Select a plan
          </option>
          {activePlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.price}/{p.billingInterval}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
