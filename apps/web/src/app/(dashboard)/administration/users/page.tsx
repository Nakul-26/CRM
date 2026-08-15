"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-auth";
import { useDeactivateUser, useInviteUser, useUsers } from "@/hooks/use-users";
import { useRoles } from "@/hooks/use-roles";
import { ApiError } from "@/lib/http";

export default function UsersPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const invite = useInviteUser();
  const deactivate = useDeactivateUser();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [result, setResult] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canInvite = currentUser?.permissions.includes("identity.users.invite");
  const canDeactivate = currentUser?.permissions.includes("identity.users.deactivate");

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const res = await invite.mutateAsync({ email, fullName, roleIds: roleId ? [roleId] : [] });
      setResult({ email: res.user.email, temporaryPassword: res.temporaryPassword });
      setEmail("");
      setFullName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to invite user");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Members of your organization.</p>
      </div>

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a user</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="" disabled>
                    Select a role
                  </option>
                  {roles?.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? "Inviting..." : "Invite"}
              </Button>
            </form>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            {result && (
              <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                Invited <strong>{result.email}</strong>. Temporary password (shown once — share it securely, a real
                notification service replaces this in a later phase): <code>{result.temporaryPassword}</code>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All users</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Email</th>
                  <th className="py-2 font-medium">Roles</th>
                  <th className="py-2 font-medium">Status</th>
                  {canDeactivate && <th className="py-2 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {users?.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0">
                    <td className="py-2">{user.fullName}</td>
                    <td className="py-2">{user.email}</td>
                    <td className="py-2">{user.roles.join(", ") || "—"}</td>
                    <td className="py-2">{user.isActive ? "Active" : "Deactivated"}</td>
                    {canDeactivate && (
                      <td className="py-2 text-right">
                        {user.isActive && (
                          <Button variant="outline" size="sm" onClick={() => deactivate.mutate(user.id)}>
                            Deactivate
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
