"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-auth";

export default function DashboardHome() {
  const { data: user } = useCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome{user ? `, ${user.fullName}` : ""}</h1>
        <p className="text-sm text-muted-foreground">Phase 1 foundation: Identity & Access is live.</p>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales metrics</CardTitle>
            <CardDescription>Arrives in Phase 8</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pipeline value, win rate, MRR/ARR, and the rest of Section 21 once the domain modules that feed them
            exist.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next up</CardTitle>
            <CardDescription>Phase 2 — CRM</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Accounts, Contacts, Activities, and the customer timeline.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
