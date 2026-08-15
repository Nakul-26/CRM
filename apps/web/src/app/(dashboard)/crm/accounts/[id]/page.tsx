"use client";

import { useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountForm } from "@/components/crm/account-form";
import { ContactForm } from "@/components/crm/contact-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccount, useDeleteAccount, useUpdateAccount } from "@/hooks/use-accounts";
import { useContacts, useCreateContact } from "@/hooks/use-contacts";
import { useCreateActivity } from "@/hooks/use-activities";
import { useTimeline } from "@/hooks/use-timeline";
import { ApiError } from "@/lib/http";
import { ACTIVITY_TYPES, type ContactDto, type CreateAccountInput, type CreateContactInput, type ActivityType } from "@sales-platform/contracts";

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: account, isLoading } = useAccount(id);
  const { data: contacts, isLoading: contactsLoading } = useContacts(id);
  const { data: timeline, isLoading: timelineLoading } = useTimeline(id);
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const createContact = useCreateContact();
  const createActivity = useCreateActivity();

  const [editOpen, setEditOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");

  const canEdit = currentUser?.permissions.includes("crm.accounts.edit");
  const canDelete = currentUser?.permissions.includes("crm.accounts.delete");
  const canCreateContact = currentUser?.permissions.includes("crm.contacts.create");
  const canLogActivity = currentUser?.permissions.includes("crm.activities.create");

  const onUpdate = async (input: CreateAccountInput) => {
    if (!account) return;
    setError(null);
    try {
      await updateAccount.mutateAsync({ id: account.id, input });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update account");
    }
  };

  const onDelete = async () => {
    if (!account) return;
    if (!window.confirm(`Delete ${account.name}? This cannot be undone.`)) return;
    await deleteAccount.mutateAsync(account.id);
    router.push("/crm/accounts");
  };

  const onCreateContact = async (input: CreateContactInput) => {
    if (!account) return;
    setError(null);
    try {
      await createContact.mutateAsync({ ...input, accountId: account.id });
      setContactDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create contact");
    }
  };

  const onLogActivity = async (e: FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setError(null);
    try {
      await createActivity.mutateAsync({
        accountId: account.id,
        type: activityType,
        subject: activitySubject,
        body: activityBody || undefined,
      });
      setActivityDialogOpen(false);
      setActivitySubject("");
      setActivityBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to log activity");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!account) return <p className="text-sm text-muted-foreground">Account not found.</p>;

  const contactColumns: DataTableColumn<ContactDto>[] = [
    { header: "Name", cell: (c) => `${c.firstName} ${c.lastName}` },
    { header: "Email", cell: (c) => c.email ?? "—" },
    { header: "Job title", cell: (c) => c.jobTitle ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/crm/accounts" className="text-sm text-muted-foreground hover:underline">
            ← Accounts
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Industry</p>
              <p>{account.industry ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Company size</p>
              <p>{account.companySize ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Website</p>
              <p>{account.website ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <p>{account.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Phone</p>
              <p>{account.phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tags</p>
              <p>{account.tags.length ? account.tags.join(", ") : "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Contacts</CardTitle>
            {canCreateContact && (
              <Button size="sm" variant="outline" onClick={() => setContactDialogOpen(true)}>
                New Contact
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable
              data={contacts}
              isLoading={contactsLoading}
              emptyMessage="No contacts on this account yet."
              rowKey={(c) => c.id}
              columns={contactColumns}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Timeline</CardTitle>
          {canLogActivity && (
            <Button size="sm" onClick={() => setActivityDialogOpen(true)}>
              Log Activity
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {timelineLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !timeline?.length ? (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {timeline.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{entry.summary}</span>
                    <span className="text-xs text-muted-foreground">{new Date(entry.occurredAt).toLocaleString()}</span>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{entry.type}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit account">
        <AccountForm initial={account} onSubmit={onUpdate} submitLabel="Save changes" isPending={updateAccount.isPending} />
      </Dialog>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen} title="New contact">
        <ContactForm accounts={[account]} initial={{ accountId: account.id }} onSubmit={onCreateContact} isPending={createContact.isPending} />
      </Dialog>

      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen} title="Log activity">
        <form onSubmit={onLogActivity} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-act-type">Type</Label>
            <select
              id="detail-act-type"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value as ActivityType)}
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
            <Label htmlFor="detail-act-subject">Subject</Label>
            <Input id="detail-act-subject" value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-act-body">Notes</Label>
            <textarea
              id="detail-act-body"
              value={activityBody}
              onChange={(e) => setActivityBody(e.target.value)}
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={createActivity.isPending} className="self-start">
            {createActivity.isPending ? "Logging..." : "Log activity"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
