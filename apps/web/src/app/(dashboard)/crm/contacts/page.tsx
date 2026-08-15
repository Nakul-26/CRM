"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { ContactForm } from "@/components/crm/contact-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useContacts, useCreateContact, useDeleteContact } from "@/hooks/use-contacts";
import { ApiError } from "@/lib/http";
import type { ContactDto, CreateContactInput } from "@sales-platform/contracts";

export default function ContactsPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: accounts } = useAccounts();
  const [accountFilter, setAccountFilter] = useState("");
  const { data: contacts, isLoading } = useContacts(accountFilter || undefined);
  const create = useCreateContact();
  const remove = useDeleteContact();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("crm.contacts.create");
  const canDelete = currentUser?.permissions.includes("crm.contacts.delete");

  const accountNameById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);

  const onCreate = async (input: CreateContactInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create contact");
    }
  };

  const onDelete = (contact: ContactDto) => {
    if (window.confirm(`Delete ${contact.firstName} ${contact.lastName}?`)) remove.mutate(contact.id);
  };

  const columns: DataTableColumn<ContactDto>[] = [
    { header: "Name", cell: (c) => `${c.firstName} ${c.lastName}` },
    { header: "Account", cell: (c) => (c.accountId ? accountNameById.get(c.accountId) ?? "—" : "—") },
    { header: "Email", cell: (c) => c.email ?? "—" },
    { header: "Job title", cell: (c) => c.jobTitle ?? "—" },
  ];
  if (canDelete) {
    columns.push({
      header: "",
      className: "text-right",
      cell: (c) => (
        <Button variant="outline" size="sm" onClick={() => onDelete(c)}>
          Delete
        </Button>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">People at your accounts.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Contact</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All contacts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <DataTable data={contacts} isLoading={isLoading} emptyMessage="No contacts yet." rowKey={(c) => c.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New contact">
        <ContactForm accounts={accounts} onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
