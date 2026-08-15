"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateTeam, useTeams } from "@/hooks/use-teams";

export default function TeamsPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: teams, isLoading } = useTeams();
  const createTeam = useCreateTeam();
  const [name, setName] = useState("");

  const canManage = currentUser?.permissions.includes("identity.teams.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">Group users for ownership and reporting.</p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a team</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createTeam.mutate({ name, memberIds: [] });
                setName("");
              }}
              className="flex items-end gap-3"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="teamName">Team name</Label>
                <Input id="teamName" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <Button type="submit" disabled={createTeam.isPending}>
                {createTeam.isPending ? "Creating..." : "Create team"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All teams</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : teams && teams.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <span>{team.name}</span>
                  <span className="text-muted-foreground">{team.memberIds.length} member(s)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No teams yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
