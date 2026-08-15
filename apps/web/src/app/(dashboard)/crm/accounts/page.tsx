"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { AccountForm } from "@/components/crm/account-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts, useCreateAccount, useDeleteAccount } from "@/hooks/use-accounts";
import { useSearch } from "@/hooks/use-search";
import { ApiError } from "@/lib/http";
import type { AccountDto, CreateAccountInput } from "@sales-platform/contracts";

export default function AccountsPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: accounts, isLoading } = useAccounts();
  const create = useCreateAccount();
  const remove = useDeleteAccount();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { data: searchResults } = useSearch(query);

  const canCreate = currentUser?.permissions.includes("crm.accounts.create");
  const canDelete = currentUser?.permissions.includes("crm.accounts.delete");

  const onCreate = async (input: CreateAccountInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create account");
    }
  };

  const onDelete = (account: AccountDto) => {
    if (window.confirm(`Delete ${account.name}? This cannot be undone.`)) remove.mutate(account.id);
  };

  const columns: DataTableColumn<AccountDto>[] = [
    {
      header: "Name",
      cell: (a) => (
        <Link href={`/crm/accounts/${a.id}`} className="font-medium hover:underline">
          {a.name}
        </Link>
      ),
    },
    { header: "Industry", cell: (a) => a.industry ?? "—" },
    { header: "Company size", cell: (a) => a.companySize ?? "—" },
    { header: "Tags", cell: (a) => (a.tags.length ? a.tags.join(", ") : "—") },
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
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">Companies and customer accounts.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Account</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input placeholder="Search accounts and contacts..." value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <div className="flex flex-col gap-1">
              {searchResults?.length ? (
                searchResults.map((r) => (
                  <Link
                    key={`${r.type}-${r.id}`}
                    href={r.type === "account" ? `/crm/accounts/${r.id}` : "/crm/contacts"}
                    className="rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="text-muted-foreground">[{r.type}]</span> {r.label}
                    {r.subLabel && <span className="text-muted-foreground"> — {r.subLabel}</span>}
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No matches.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={accounts} isLoading={isLoading} emptyMessage="No accounts yet." rowKey={(a) => a.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New account">
        <AccountForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
