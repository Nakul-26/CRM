"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-auth";
import { useDashboardStats } from "@/hooks/use-analytics";

const currency = (n: number) => `$${Math.round(n).toLocaleString()}`;

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tracking-tight">{value}</span>
    </div>
  );
}

export default function DashboardHome() {
  const { data: user } = useCurrentUser();
  const canViewAnalytics = user?.permissions.includes("analytics.view") ?? false;
  const { data: stats, isLoading: statsLoading } = useDashboardStats(canViewAnalytics);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome{user ? `, ${user.fullName}` : ""}</h1>
        <p className="text-sm text-muted-foreground">An overview of your organization's pipeline and recurring revenue.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your permissions</CardTitle>
            <CardDescription>{user?.permissions.length ?? 0} granted</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Permission-based RBAC (Section 19) — roles are just named bundles of these.
          </CardContent>
        </Card>

        {canViewAnalytics && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pipeline</CardTitle>
                <CardDescription>Open opportunities</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {statsLoading || !stats ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <>
                    <StatRow label="Open value" value={currency(stats.openPipelineValue)} />
                    <StatRow label="Weighted value" value={currency(stats.weightedPipelineValue)} />
                    <StatRow label="Win rate" value={`${Math.round(stats.winRate * 100)}%`} />
                    <StatRow label="Open deals" value={String(stats.openOpportunitiesCount)} />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recurring revenue</CardTitle>
                <CardDescription>Active subscriptions</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {statsLoading || !stats ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <>
                    <StatRow label="MRR" value={currency(stats.mrr)} />
                    <StatRow label="ARR" value={currency(stats.arr)} />
                    <StatRow label="Active subscriptions" value={String(stats.activeSubscriptionsCount)} />
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
