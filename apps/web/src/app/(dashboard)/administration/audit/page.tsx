"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogStream } from "@/hooks/use-audit-log-stream";
import { useUsers } from "@/hooks/use-users";
import { AUDIT_LOG_EXPORT_MAX_ROWS, type AuditLogEntryDto } from "@sales-platform/contracts";

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [eventType, setEventType] = useState("");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditLogEntryDto | null>(null);

  const { data: users } = useUsers();
  const { data, isLoading, refetch } = useAuditLog({
    eventType: eventType || undefined,
    actorId: actorId || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const { hasNew, dismiss } = useAuditLogStream(
    {
      eventType: eventType || undefined,
      actorId: actorId || undefined,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
    },
    offset === 0,
  );

  const resetToFirstPage = () => setOffset(0);

  const columns: DataTableColumn<AuditLogEntryDto>[] = [
    { header: "When", cell: (e) => new Date(e.createdAt).toLocaleString() },
    { header: "Event", cell: (e) => <span className="font-mono text-xs">{e.eventType}</span> },
    { header: "Actor", cell: (e) => e.actorName ?? "System" },
    {
      header: "",
      className: "text-right",
      cell: (e) => (
        <Button variant="outline" size="sm" onClick={() => setSelected(e)}>
          View
        </Button>
      ),
    },
  ];

  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  const exportFilters = new URLSearchParams();
  if (eventType) exportFilters.set("eventType", eventType);
  if (actorId) exportFilters.set("actorId", actorId);
  if (dateFrom) exportFilters.set("dateFrom", new Date(dateFrom).toISOString());
  if (dateTo) exportFilters.set("dateTo", new Date(dateTo).toISOString());
  const exportHref = `/api/gateway/audit-log/export?${exportFilters.toString()}`;
  const canExport = total > 0 && total <= AUDIT_LOG_EXPORT_MAX_ROWS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Every recorded business action across the organization.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle className="mr-auto text-base">Events</CardTitle>
          <input
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              resetToFirstPage();
            }}
            placeholder="Event type (e.g. ticket.created)"
            className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
          />
          <select
            value={actorId}
            onChange={(e) => {
              setActorId(e.target.value);
              resetToFirstPage();
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All actors</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetToFirstPage();
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetToFirstPage();
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          {canExport ? (
            <a href={exportHref}>
              <Button variant="outline" size="sm">
                Export CSV
              </Button>
            </a>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              title={total > AUDIT_LOG_EXPORT_MAX_ROWS ? `Narrow filters — ${total.toLocaleString()} rows match, export limit is ${AUDIT_LOG_EXPORT_MAX_ROWS.toLocaleString()}` : undefined}
            >
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {hasNew && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
              <span>New audit events have come in.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  dismiss();
                  refetch();
                }}
              >
                Refresh
              </Button>
            </div>
          )}
          <DataTable data={data?.items} isLoading={isLoading} emptyMessage="No audit events match these filters." rowKey={(e) => e.id} columns={columns} />
          {total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={!canPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title="Event details" className="max-w-2xl">
        {selected && (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <span className="font-medium">Event: </span>
              <span className="font-mono text-xs">{selected.eventType}</span>
            </div>
            <div>
              <span className="font-medium">When: </span>
              {new Date(selected.createdAt).toLocaleString()}
            </div>
            <div>
              <span className="font-medium">Actor: </span>
              {selected.actorName ? `${selected.actorName} (${selected.actorEmail})` : "System"}
            </div>
            {selected.ip && (
              <div>
                <span className="font-medium">IP: </span>
                {selected.ip}
              </div>
            )}
            {selected.userAgent && (
              <div>
                <span className="font-medium">User agent: </span>
                <span className="break-all">{selected.userAgent}</span>
              </div>
            )}
            <div>
              <span className="mb-1 block font-medium">Payload:</span>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
