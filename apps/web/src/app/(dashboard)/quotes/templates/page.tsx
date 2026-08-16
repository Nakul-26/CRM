"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineItemEditor } from "@/components/quotes/line-item-editor";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateQuoteTemplate, useDeleteQuoteTemplate, useQuoteTemplates } from "@/hooks/use-quotes";
import { ApiError } from "@/lib/http";
import type { LineItemInput } from "@sales-platform/contracts";

export default function QuoteTemplatesPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: templates, isLoading } = useQuoteTemplates();
  const deleteTemplate = useDeleteQuoteTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = currentUser?.permissions.includes("quotes.templates.manage");

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    setError(null);
    try {
      await deleteTemplate.mutateAsync(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to delete template");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quote Templates</h1>
          <p className="text-sm text-muted-foreground">Reusable terms and starter line items for new quotes.</p>
        </div>
        {canManage && <Button onClick={() => setDialogOpen(true)}>New Template</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All templates</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : templates && templates.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.defaultLineItems.length} default line item(s)</p>
                  </div>
                  {canManage && (
                    <Button variant="outline" size="sm" onClick={() => onDelete(t.id, t.name)}>
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No templates yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New template" className="max-w-3xl">
        <TemplateForm onDone={() => setDialogOpen(false)} />
      </Dialog>
    </div>
  );
}

function TemplateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateQuoteTemplate();
  const [name, setName] = useState("");
  const [termsText, setTermsText] = useState("");
  const [defaultNotes, setDefaultNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItemInput[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        name,
        termsText: termsText || undefined,
        defaultNotes: defaultNotes || undefined,
        defaultLineItems: lineItems,
        isDefault: false,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create template");
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-name">Name</Label>
        <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-terms">Terms & conditions</Label>
        <textarea
          id="tpl-terms"
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-notes">Default notes</Label>
        <textarea
          id="tpl-notes"
          value={defaultNotes}
          onChange={(e) => setDefaultNotes(e.target.value)}
          rows={2}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Default line items</Label>
        <LineItemEditor value={lineItems} onChange={setLineItems} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={create.isPending} className="self-start">
        {create.isPending ? "Saving..." : "Create template"}
      </Button>
    </form>
  );
}
