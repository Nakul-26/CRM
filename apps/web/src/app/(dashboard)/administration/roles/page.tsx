"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRoles } from "@/hooks/use-roles";

export default function RolesPage() {
  const { data: roles, isLoading } = useRoles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Roles are named bundles of permissions (Section 19) — Owner, Admin, and Member are seeded automatically for
          every organization.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {roles?.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {role.name}
                  {role.isSystemRole && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      System
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{role.permissions.length} permissions</p>
                <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                  {role.permissions.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
