"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts } from "@/hooks/use-contacts";
import { LEAD_SOURCES, type CreateOpportunityInput, type OpportunityDto, type OpportunitySource } from "@sales-platform/contracts";

export function OpportunityForm({
  initial,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initial?: Partial<OpportunityDto>;
  onSubmit: (input: CreateOpportunityInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const isEditing = Boolean(initial?.id);
  const { data: accounts } = useAccounts();

  const [name, setName] = useState(initial?.name ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const { data: contacts } = useContacts(accountId || undefined);
  const [value, setValue] = useState(initial?.value != null ? String(initial.value) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    initial?.expectedCloseDate ? initial.expectedCloseDate.slice(0, 10) : "",
  );
  const [source, setSource] = useState<OpportunitySource | "">(initial?.source ?? "");
  const [competitors, setCompetitors] = useState(initial?.competitors?.join(", ") ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      accountId,
      contactId: contactId || undefined,
      value: value.trim() ? Number(value) : undefined,
      currency: currency || undefined,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate).toISOString() : undefined,
      source: source || undefined,
      competitors: competitors
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      notes: notes || undefined,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-name">Name</Label>
        <Input id="opp-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-account">Account</Label>
          <select
            id="opp-account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setContactId("");
            }}
            required
            disabled={isEditing}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
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
          <Label htmlFor="opp-contact">Primary contact</Label>
          <select
            id="opp-contact"
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
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-value">Value</Label>
          <Input id="opp-value" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-currency">Currency</Label>
          <Input id="opp-currency" value={currency ?? ""} onChange={(e) => setCurrency(e.target.value)} maxLength={10} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-close-date">Expected close date</Label>
          <Input
            id="opp-close-date"
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-source">Source</Label>
          <select
            id="opp-source"
            value={source}
            onChange={(e) => setSource(e.target.value as OpportunitySource)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Unspecified</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-competitors">Competitors (comma-separated)</Label>
        <Input id="opp-competitors" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Acme Co, Globex" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-notes">Notes</Label>
        <textarea
          id="opp-notes"
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
