"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_SOURCES, type CreateLeadInput, type LeadDto, type LeadSource } from "@sales-platform/contracts";
import { useLeadDuplicates } from "@/hooks/use-leads";

export function LeadForm({
  initial,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initial?: Partial<LeadDto>;
  onSubmit: (input: CreateLeadInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const isEditing = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [source, setSource] = useState<LeadSource>(initial?.source ?? "website");
  const [campaign, setCampaign] = useState(initial?.campaign ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [estimatedValue, setEstimatedValue] = useState(initial?.estimatedValue != null ? String(initial.estimatedValue) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "");

  // Non-blocking duplicate warning — only relevant while creating a new lead.
  const { data: duplicates } = useLeadDuplicates(isEditing ? "" : email ?? "", isEditing ? "" : company ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      company: company || undefined,
      email: email || undefined,
      phone: phone || undefined,
      source,
      campaign: campaign || undefined,
      industry: industry || undefined,
      location: location || undefined,
      estimatedValue: estimatedValue.trim() ? Number(estimatedValue) : undefined,
      notes: notes || undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {!isEditing && duplicates && duplicates.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Possible duplicate: {duplicates.map((d) => d.name).join(", ")} already exist{duplicates.length === 1 ? "s" : ""} with a matching email or company.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-name">Name</Label>
          <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-company">Company</Label>
          <Input id="lead-company" value={company ?? ""} onChange={(e) => setCompany(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-email">Email</Label>
          <Input id="lead-email" type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-phone">Phone</Label>
          <Input id="lead-phone" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-source">Source</Label>
          <select
            id="lead-source"
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSource)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-campaign">Campaign</Label>
          <Input id="lead-campaign" value={campaign ?? ""} onChange={(e) => setCampaign(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-industry">Industry</Label>
          <Input id="lead-industry" value={industry ?? ""} onChange={(e) => setIndustry(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-location">Location</Label>
          <Input id="lead-location" value={location ?? ""} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-value">Estimated value</Label>
          <Input id="lead-value" type="number" min="0" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-tags">Tags (comma-separated)</Label>
          <Input id="lead-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hot, enterprise" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lead-notes">Notes</Label>
        <textarea
          id="lead-notes"
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
