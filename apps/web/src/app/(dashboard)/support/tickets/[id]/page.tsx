"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { TicketCommentThread } from "@/components/support/ticket-comment-thread";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useUsers } from "@/hooks/use-users";
import { useAssignTicket, useDeleteTicket, useTicket, useUpdateTicketStatus } from "@/hooks/use-tickets";
import { ApiError } from "@/lib/http";
import type { TicketStatus } from "@sales-platform/contracts";

const STATUS_ACTIONS: Record<TicketStatus, { label: string; target: TicketStatus }[]> = {
  open: [
    { label: "Start progress", target: "in_progress" },
    { label: "Resolve", target: "resolved" },
    { label: "Close", target: "closed" },
  ],
  in_progress: [
    { label: "Mark open", target: "open" },
    { label: "Resolve", target: "resolved" },
    { label: "Close", target: "closed" },
  ],
  resolved: [
    { label: "Reopen", target: "open" },
    { label: "Close", target: "closed" },
  ],
  closed: [{ label: "Reopen", target: "open" }],
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: currentUser } = useCurrentUser();
  const { data: ticket, isLoading } = useTicket(id);
  const { data: accounts } = useAccounts();
  const { data: users } = useUsers();
  const updateStatus = useUpdateTicketStatus();
  const assignTicket = useAssignTicket();
  const deleteTicket = useDeleteTicket();

  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const canManage = currentUser?.permissions.includes("support.tickets.manage");
  const canEdit = currentUser?.permissions.includes("support.tickets.edit");
  const canDelete = currentUser?.permissions.includes("support.tickets.delete");

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : message);
    }
  };

  const onDelete = async () => {
    if (!ticket) return;
    if (!window.confirm(`Delete ticket "${ticket.subject}"? This cannot be undone.`)) return;
    await deleteTicket.mutateAsync(ticket.id);
    window.location.href = "/support/tickets";
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!ticket) return <p className="text-sm text-muted-foreground">Ticket not found.</p>;

  const account = accounts?.find((a) => a.id === ticket.accountId);
  const assignee = users?.find((u) => u.id === ticket.assigneeId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/support/tickets" className="text-sm text-muted-foreground hover:underline">
            ← Tickets
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
          {account && (
            <Link href={`/crm/accounts/${account.id}`} className="text-sm text-muted-foreground hover:underline">
              {account.name}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit &&
            STATUS_ACTIONS[ticket.status].map((action) => (
              <Button
                key={action.target}
                variant="outline"
                onClick={() => runAction(() => updateStatus.mutateAsync({ id: ticket.id, status: action.target }), "Failed to update status")}
              >
                {action.label}
              </Button>
            ))}
          {canManage && (
            <Button variant="outline" onClick={() => setAssignOpen(true)}>
              Assign
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
        <CardHeader>
          <CardTitle className="text-base capitalize">Status: {ticket.status.replace("_", " ")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Priority</p>
            <p className="capitalize">{ticket.priority}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Assignee</p>
            <p>{assignee?.fullName ?? "Unassigned"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">First response due</p>
            <p className={ticket.firstResponseBreached ? "text-destructive" : undefined}>
              {ticket.firstResponseDueAt ? new Date(ticket.firstResponseDueAt).toLocaleString() : "—"}
              {ticket.firstResponseBreached ? " (breached)" : ""}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Resolution due</p>
            <p className={ticket.resolutionBreached ? "text-destructive" : undefined}>
              {ticket.resolutionDueAt ? new Date(ticket.resolutionDueAt).toLocaleString() : "—"}
              {ticket.resolutionBreached ? " (breached)" : ""}
            </p>
          </div>
        </CardContent>
        {ticket.description && (
          <CardContent className="border-t border-border pt-4">
            <p className="text-muted-foreground">Description</p>
            <p className="whitespace-pre-wrap">{ticket.description}</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <TicketCommentThread ticketId={ticket.id} />
        </CardContent>
      </Card>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen} title="Assign ticket">
        <div className="flex flex-col gap-3">
          <select
            defaultValue={ticket.assigneeId ?? ""}
            onChange={async (e) => {
              await runAction(
                () => assignTicket.mutateAsync({ id: ticket.id, input: { assigneeId: e.target.value || null } }),
                "Failed to assign ticket",
              );
              setAssignOpen(false);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </div>
      </Dialog>
    </div>
  );
}
