"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useOpportunityForecast, useOpportunityStats } from "@/hooks/use-opportunities";
import type { OpportunityForecastPointDto } from "@sales-platform/contracts";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

const currency = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function ForecastPage() {
  const { data: stats, isLoading: statsLoading } = useOpportunityStats();
  const { data: forecast, isLoading: forecastLoading } = useOpportunityForecast();

  const columns: DataTableColumn<OpportunityForecastPointDto>[] = [
    { header: "Month", cell: (f) => f.month },
    { header: "Open deals", cell: (f) => f.count },
    { header: "Value", cell: (f) => currency(f.value) },
    { header: "Weighted value", cell: (f) => currency(f.weightedValue) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="text-sm text-muted-foreground">Pipeline health and revenue forecasting.</p>
      </div>

      {statsLoading || !stats ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total pipeline value" value={currency(stats.totalPipelineValue)} />
          <StatCard label="Weighted pipeline" value={currency(stats.weightedPipelineValue)} />
          <StatCard label="Won revenue" value={currency(stats.wonRevenue)} />
          <StatCard label="Lost revenue" value={currency(stats.lostRevenue)} />
          <StatCard label="Win rate" value={`${Math.round(stats.winRate * 100)}%`} />
          <StatCard label="Avg deal size" value={currency(stats.averageDealSize)} />
          <StatCard label="Avg sales cycle" value={`${Math.round(stats.averageSalesCycleDays)} days`} />
          <StatCard label="Sales velocity" value={currency(stats.salesVelocity)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forecast by expected close month</CardTitle>
        </CardHeader>
        <CardContent>
          {forecast && forecast.length > 0 ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => currency(v)} />
                  <Bar dataKey="value" name="Value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="weightedValue" name="Weighted value" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {forecastLoading ? "Loading..." : "No open opportunities with an expected close date yet."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={forecast} isLoading={forecastLoading} emptyMessage="No forecast data yet." rowKey={(f) => f.month} columns={columns} />
        </CardContent>
      </Card>
    </div>
  );
}
