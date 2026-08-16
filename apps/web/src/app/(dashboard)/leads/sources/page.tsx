"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useLeadSourceStats } from "@/hooks/use-leads";
import type { LeadSourceStatDto } from "@sales-platform/contracts";

export default function LeadSourcesPage() {
  const { data: stats, isLoading } = useLeadSourceStats();
  const total = stats?.reduce((sum, s) => sum + s.count, 0) ?? 0;

  const columns: DataTableColumn<LeadSourceStatDto>[] = [
    { header: "Source", cell: (s) => s.source.replace("_", " ") },
    { header: "Leads", cell: (s) => s.count },
    { header: "Share", cell: (s) => (total ? `${Math.round((s.count / total) * 100)}%` : "—") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead Sources</h1>
        <p className="text-sm text-muted-foreground">Where your leads are coming from.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown by source</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={stats ? [...stats].sort((a, b) => b.count - a.count) : stats}
            isLoading={isLoading}
            emptyMessage="No leads yet."
            rowKey={(s) => s.source}
            columns={columns}
          />
        </CardContent>
      </Card>
    </div>
  );
}
