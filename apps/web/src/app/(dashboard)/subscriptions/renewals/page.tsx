"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccounts } from "@/hooks/use-accounts";
import { useRenewSubscription, useSubscriptions } from "@/hooks/use-subscriptions";
import { ApiError } from "@/lib/http";

function daysUntil(date: string) {
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function RenewalsPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: accounts } = useAccounts();
  const { data: active, isLoading: loadingActive } = useSubscriptions({ status: "active" });
  const { data: lapsed, isLoading: loadingLapsed } = useSubscriptions({ status: "lapsed" });
  const renew = useRenewSubscription();

  const canEdit = currentUser?.permissions.includes("subscriptions.edit");
  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "—";

  const isLoading = loadingActive || loadingLapsed;
  const upcoming = [...(active ?? []), ...(lapsed ?? [])].sort(
    (a, b) => new Date(a.currentPeriodEnd).getTime() - new Date(b.currentPeriodEnd).getTime(),
  );

  const onRenew = async (id: string) => {
    try {
      await renew.mutateAsync(id);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.body.error.message : "Failed to renew subscription");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Renewals</h1>
        <p className="text-sm text-muted-foreground">Upcoming and overdue subscription renewals, soonest first.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Renewal schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : upcoming.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 font-medium">Account</th>
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium">Renews</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Reminder</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {upcoming.map((s) => {
                  const days = daysUntil(s.currentPeriodEnd);
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="py-2">{accountName(s.accountId)}</td>
                      <td className="py-2">{s.planName}</td>
                      <td className="py-2">
                        {new Date(s.currentPeriodEnd).toLocaleDateString()}{" "}
                        <span className={days < 0 ? "text-destructive" : "text-muted-foreground"}>
                          ({days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`})
                        </span>
                      </td>
                      <td className="py-2 capitalize">{s.status}</td>
                      <td className="py-2">{s.currentPeriodReminderSent ? "Sent" : "Not yet"}</td>
                      <td className="py-2">
                        {canEdit && (
                          <Button variant="outline" size="sm" onClick={() => onRenew(s.id)}>
                            Renew
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No upcoming renewals.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
