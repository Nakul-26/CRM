"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts } from "@/hooks/use-contacts";
import { useActivities, useCreateActivity, useDeleteActivity } from "@/hooks/use-activities";
import { ApiError } from "@/lib/http";
import { ACTIVITY_TYPES, type ActivityDto, type ActivityType } from "@sales-platform/contracts";

export default function ActivitiesPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: accounts } = useAccounts();
  const { data: contacts } = useContacts();
  const { data: activities, isLoading } = useActivities();
  const create = useCreateActivity();
  const remove = useDeleteActivity();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ActivityType>("call");
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const canCreate = currentUser?.permissions.includes("crm.activities.create");
  const canDelete = currentUser?.permissions.includes("crm.activities.delete");

  const accountNameById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const contactNameById = useMemo(() => new Map((contacts ?? []).map((c) => [c.id, `${c.firstName} ${c.lastName}`])), [contacts]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        type,
        subject,
        body: body || undefined,
        accountId: accountId || undefined,
        contactId: contactId || undefined,
      });
      setDialogOpen(false);
      setSubject("");
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to log activity");
    }
  };

  const onDelete = (activity: ActivityDto) => {
    if (window.confirm(`Delete "${activity.subject}"?`)) remove.mutate(activity.id);
  };

  const columns: DataTableColumn<ActivityDto>[] = [
    { header: "Type", cell: (a) => a.type },
    { header: "Subject", cell: (a) => a.subject },
    { header: "Account", cell: (a) => (a.accountId ? accountNameById.get(a.accountId) ?? "—" : "—") },
    { header: "Contact", cell: (a) => (a.contactId ? contactNameById.get(a.contactId) ?? "—" : "—") },
  ];
  if (canDelete) {
    columns.push({
      header: "",
      className: "text-right",
      cell: (a) => (
        <Button variant="outline" size="sm" onClick={() => onDelete(a)}>
          Delete
        </Button>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="text-sm text-muted-foreground">Calls, emails, meetings, notes, and tasks.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>Log Activity</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All activities</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={activities} isLoading={isLoading} emptyMessage="No activities logged yet." rowKey={(a) => a.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="Log activity">
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-type">Type</Label>
              <select
                id="act-type"
                value={type}
                onChange={(e) => setType(e.target.value as ActivityType)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-subject">Subject</Label>
              <Input id="act-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-account">Account</Label>
              <select
                id="act-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="act-contact">Contact</Label>
              <select
                id="act-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {contacts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="act-body">Notes</Label>
            <textarea
              id="act-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {!accountId && !contactId && <p className="text-xs text-muted-foreground">Select an account or a contact.</p>}
          <Button type="submit" disabled={create.isPending || (!accountId && !contactId)} className="self-start">
            {create.isPending ? "Logging..." : "Log activity"}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
