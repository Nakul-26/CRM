"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts } from "@/hooks/use-contacts";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useQuoteTemplates } from "@/hooks/use-quotes";
import { LineItemEditor, lineTotal } from "./line-item-editor";
import type { CreateQuoteInput, LineItemInput, QuoteDto, QuoteVersionDto } from "@sales-platform/contracts";

export function QuoteForm({
  initialQuote,
  initialVersion,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initialQuote?: QuoteDto;
  initialVersion?: QuoteVersionDto;
  /** Always a full CreateQuoteInput shape — the caller strips accountId/templateId when calling the update endpoint. */
  onSubmit: (input: CreateQuoteInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const isEditing = Boolean(initialQuote?.id);
  const { data: accounts } = useAccounts();
  const { data: templates } = useQuoteTemplates();
  const { data: allOpportunities } = useOpportunities();

  const [accountId, setAccountId] = useState(initialQuote?.accountId ?? "");
  const [contactId, setContactId] = useState(initialQuote?.contactId ?? "");
  const { data: contacts } = useContacts(accountId || undefined);
  const [opportunityId, setOpportunityId] = useState(initialQuote?.opportunityId ?? "");
  const [templateId, setTemplateId] = useState("");
  const [currency, setCurrency] = useState(initialQuote?.currency ?? "USD");
  const [validUntil, setValidUntil] = useState(initialQuote?.validUntil ? initialQuote.validUntil.slice(0, 10) : "");
  const [notes, setNotes] = useState(initialQuote?.notes ?? "");
  const [lineItems, setLineItems] = useState<LineItemInput[]>(
    initialVersion?.lineItems.map((li) => ({
      productId: li.productId ?? undefined,
      name: li.name,
      description: li.description ?? undefined,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountPercent: li.discountPercent,
      taxPercent: li.taxPercent,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const opportunitiesForAccount = allOpportunities?.filter((o) => o.accountId === accountId) ?? [];
  const total = lineItems.reduce((sum, item) => sum + lineTotal(item), 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (lineItems.length === 0 && !(!isEditing && templateId)) {
      setError("Add at least one line item.");
      return;
    }
    setError(null);
    onSubmit({
      accountId,
      contactId: contactId || undefined,
      opportunityId: opportunityId || undefined,
      templateId: !isEditing && templateId ? templateId : undefined,
      currency,
      validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
      notes: notes || undefined,
      lineItems,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-account">Account</Label>
          <select
            id="quote-account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setContactId("");
              setOpportunityId("");
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
          <Label htmlFor="quote-contact">Contact</Label>
          <select
            id="quote-contact"
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
          <Label htmlFor="quote-opportunity">Opportunity</Label>
          <select
            id="quote-opportunity"
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            disabled={!accountId}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            <option value="">None</option>
            {opportunitiesForAccount.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {!isEditing && templates && templates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-template">Template</Label>
            <select
              id="quote-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-currency">Currency</Label>
          <Input id="quote-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-valid-until">Valid until</Label>
          <Input id="quote-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Line items</Label>
        {!isEditing && templateId && lineItems.length === 0 && (
          <p className="text-xs text-muted-foreground">Will be pre-filled from the selected template.</p>
        )}
        <LineItemEditor value={lineItems} onChange={setLineItems} />
        <p className="self-end text-sm font-medium">Total: {total.toFixed(2)}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quote-notes">Notes</Label>
        <textarea
          id="quote-notes"
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
