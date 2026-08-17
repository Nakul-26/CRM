"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TICKET_PRIORITIES, type CreateSlaPolicyInput, type SlaPolicyDto } from "@sales-platform/contracts";

export function SlaPolicyForm({
  initialPolicy,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initialPolicy?: SlaPolicyDto;
  onSubmit: (input: CreateSlaPolicyInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const [name, setName] = useState(initialPolicy?.name ?? "");
  const [priority, setPriority] = useState(initialPolicy?.priority ?? "medium");
  const [firstResponseTargetMinutes, setFirstResponseTargetMinutes] = useState(initialPolicy?.firstResponseTargetMinutes ?? 60);
  const [resolutionTargetMinutes, setResolutionTargetMinutes] = useState(initialPolicy?.resolutionTargetMinutes ?? 480);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ name, priority: priority as never, firstResponseTargetMinutes, resolutionTargetMinutes });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sla-name">Name</Label>
        <Input id="sla-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sla-priority">Priority</Label>
        <select
          id="sla-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as never)}
          disabled={Boolean(initialPolicy)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        >
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sla-first-response">First response target (minutes)</Label>
          <Input
            id="sla-first-response"
            type="number"
            min={1}
            value={firstResponseTargetMinutes}
            onChange={(e) => setFirstResponseTargetMinutes(Number(e.target.value))}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sla-resolution">Resolution target (minutes)</Label>
          <Input
            id="sla-resolution"
            type="number"
            min={1}
            value={resolutionTargetMinutes}
            onChange={(e) => setResolutionTargetMinutes(Number(e.target.value))}
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
