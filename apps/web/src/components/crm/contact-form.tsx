"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountDto, ContactDto, CreateContactInput } from "@sales-platform/contracts";

export function ContactForm({
  accounts,
  initial,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  accounts: AccountDto[] | undefined;
  initial?: Partial<ContactDto>;
  onSubmit: (input: CreateContactInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      accountId: accountId || undefined,
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      jobTitle: jobTitle || undefined,
      department: department || undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-first">First name</Label>
          <Input id="con-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-last">Last name</Label>
          <Input id="con-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="con-account">Account</Label>
        <select
          id="con-account"
          value={accountId ?? ""}
          onChange={(e) => setAccountId(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">No account</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-email">Email</Label>
          <Input id="con-email" type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-phone">Phone</Label>
          <Input id="con-phone" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-title">Job title</Label>
          <Input id="con-title" value={jobTitle ?? ""} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="con-dept">Department</Label>
          <Input id="con-dept" value={department ?? ""} onChange={(e) => setDepartment(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="con-tags">Tags (comma-separated)</Label>
        <Input id="con-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
