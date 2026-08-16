"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { LeadForm } from "@/components/leads/lead-form";
import { useCurrentUser } from "@/hooks/use-auth";
import {
  useConvertLead,
  useDeleteLead,
  useLead,
  useMarkLeadContacted,
  useQualifyLead,
  useRecalculateLeadScore,
  useUpdateLead,
} from "@/hooks/use-leads";
import { ApiError } from "@/lib/http";
import type { CreateLeadInput } from "@sales-platform/contracts";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: lead, isLoading } = useLead(id);
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const markContacted = useMarkLeadContacted();
  const qualify = useQualifyLead();
  const convert = useConvertLead();
  const recalculateScore = useRecalculateLeadScore();

  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = currentUser?.permissions.includes("leads.edit");
  const canDelete = currentUser?.permissions.includes("leads.delete");
  const canConvert = currentUser?.permissions.includes("leads.convert");

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  const onUpdate = async (input: CreateLeadInput) => {
    if (!lead) return;
    setError(null);
    try {
      await updateLead.mutateAsync({ id: lead.id, input });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update lead");
    }
  };

  const onDelete = async () => {
    if (!lead) return;
    if (!window.confirm(`Delete lead "${lead.name}"? This cannot be undone.`)) return;
    await deleteLead.mutateAsync(lead.id);
    router.push("/leads");
  };

  const onConvert = async () => {
    if (!lead) return;
    if (!window.confirm(`Convert "${lead.name}" into an Account and Contact?`)) return;
    await runAction(() => convert.mutateAsync(lead.id), "Failed to convert lead");
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!lead) return <p className="text-sm text-muted-foreground">Lead not found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/leads" className="text-sm text-muted-foreground hover:underline">
            ← Leads
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
        </div>
        <div className="flex gap-2">
          {canEdit && lead.status !== "Converted" && (
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Status</CardTitle>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">{lead.status}</span>
            <span className="text-xs text-muted-foreground">Score: {lead.score}</span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canEdit && lead.status === "New" && (
            <Button size="sm" variant="outline" onClick={() => runAction(() => markContacted.mutateAsync(lead.id), "Failed to update lead")}>
              Mark Contacted
            </Button>
          )}
          {canEdit && (lead.status === "New" || lead.status === "Contacted") && (
            <>
              <Button size="sm" onClick={() => runAction(() => qualify.mutateAsync({ id: lead.id, outcome: "qualified" }), "Failed to qualify lead")}>
                Qualify
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAction(() => qualify.mutateAsync({ id: lead.id, outcome: "unqualified" }), "Failed to update lead")}
              >
                Mark Unqualified
              </Button>
            </>
          )}
          {canConvert && lead.status === "Qualified" && (
            <Button size="sm" onClick={onConvert}>
              Convert to Account + Contact
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => runAction(() => recalculateScore.mutateAsync(lead.id), "Failed to recalculate score")}>
              Recalculate score
            </Button>
          )}
        </CardContent>
      </Card>

      {lead.status === "Converted" && lead.convertedAccountId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Converted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            This lead converted to{" "}
            <Link href={`/crm/accounts/${lead.convertedAccountId}`} className="font-medium hover:underline">
              its account
            </Link>
            {lead.convertedAt && <span className="text-muted-foreground"> on {new Date(lead.convertedAt).toLocaleString()}</span>}.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Company</p>
            <p>{lead.company ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p>{lead.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Phone</p>
            <p>{lead.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Source</p>
            <p>{lead.source.replace("_", " ")}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Campaign</p>
            <p>{lead.campaign ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Industry</p>
            <p>{lead.industry ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Location</p>
            <p>{lead.location ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Estimated value</p>
            <p>{lead.estimatedValue != null ? lead.estimatedValue : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tags</p>
            <p>{lead.tags.length ? lead.tags.join(", ") : "—"}</p>
          </div>
          {lead.notes && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Notes</p>
              <p className="whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit lead">
        <LeadForm initial={lead} onSubmit={onUpdate} submitLabel="Save changes" isPending={updateLead.isPending} />
      </Dialog>
    </div>
  );
}
