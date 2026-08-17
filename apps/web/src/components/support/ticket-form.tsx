"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts } from "@/hooks/use-contacts";
import { TICKET_PRIORITIES, type CreateTicketInput, type TicketDto } from "@sales-platform/contracts";

export function TicketForm({
  initialTicket,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initialTicket?: TicketDto;
  onSubmit: (input: CreateTicketInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const isEditing = Boolean(initialTicket?.id);
  const { data: accounts } = useAccounts();

  const [accountId, setAccountId] = useState(initialTicket?.accountId ?? "");
  const [contactId, setContactId] = useState(initialTicket?.contactId ?? "");
  const { data: contacts } = useContacts(accountId || undefined);
  const [subject, setSubject] = useState(initialTicket?.subject ?? "");
  const [description, setDescription] = useState(initialTicket?.description ?? "");
  const [priority, setPriority] = useState(initialTicket?.priority ?? "medium");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      subject,
      description: description || undefined,
      accountId,
      contactId: contactId || undefined,
      priority: priority as never,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-account">Account</Label>
          <select
            id="ticket-account"
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
          <Label htmlFor="ticket-contact">Contact</Label>
          <select
            id="ticket-contact"
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
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-priority">Priority</Label>
          <select
            id="ticket-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as never)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ticket-description">Description</Label>
        <textarea
          id="ticket-description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
