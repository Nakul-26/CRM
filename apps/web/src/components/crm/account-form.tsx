"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMPANY_SIZES, type AccountDto, type CreateAccountInput } from "@sales-platform/contracts";

export function AccountForm({
  initial,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initial?: Partial<AccountDto>;
  onSubmit: (input: CreateAccountInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [companySize, setCompanySize] = useState(initial?.companySize ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      industry: industry || undefined,
      companySize: (companySize || undefined) as CreateAccountInput["companySize"],
      website: website || undefined,
      email: email || undefined,
      phone: phone || undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="acc-name">Name</Label>
        <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-industry">Industry</Label>
          <Input id="acc-industry" value={industry ?? ""} onChange={(e) => setIndustry(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-size">Company size</Label>
          <select
            id="acc-size"
            value={companySize ?? ""}
            onChange={(e) => setCompanySize(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-website">Website</Label>
          <Input id="acc-website" value={website ?? ""} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-email">Email</Label>
          <Input id="acc-email" type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-phone">Phone</Label>
          <Input id="acc-phone" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-tags">Tags (comma-separated)</Label>
          <Input id="acc-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, renewal" />
        </div>
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
