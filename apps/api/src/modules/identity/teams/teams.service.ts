import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { CreateTeamInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { teamMembers, teams, users } from "../../../database/schema";

@Injectable()
export class TeamsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async listForOrganization(organizationId: string) {
    const rows = await this.db
      .select({ team: teams, userId: teamMembers.userId })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .where(eq(teams.organizationId, organizationId));

    const byTeam = new Map<string, { id: string; organizationId: string; name: string; memberIds: string[] }>();
    for (const row of rows) {
      const existing = byTeam.get(row.team.id);
      if (existing) {
        if (row.userId) existing.memberIds.push(row.userId);
      } else {
        byTeam.set(row.team.id, {
          id: row.team.id,
          organizationId: row.team.organizationId,
          name: row.team.name,
          memberIds: row.userId ? [row.userId] : [],
        });
      }
    }
    return [...byTeam.values()];
  }

  async create(organizationId: string, input: CreateTeamInput) {
    if (input.memberIds.length > 0) {
      await this.requireUsersInOrganization(organizationId, input.memberIds);
    }
    const [team] = await this.db.insert(teams).values({ organizationId, name: input.name }).returning();
    if (input.memberIds.length > 0) {
      await this.db.insert(teamMembers).values(input.memberIds.map((userId) => ({ teamId: team.id, userId })));
    }
    return team;
  }

  async addMember(organizationId: string, teamId: string, userId: string) {
    await this.requireTeam(organizationId, teamId);
    await this.requireUsersInOrganization(organizationId, [userId]);
    await this.db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  }

  async removeMember(organizationId: string, teamId: string, userId: string) {
    await this.requireTeam(organizationId, teamId);
    await this.requireUsersInOrganization(organizationId, [userId]);
    await this.db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }

  private async requireTeam(organizationId: string, teamId: string) {
    const [team] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organizationId, organizationId), eq(teams.id, teamId)))
      .limit(1);
    if (!team) throw new NotFoundException(`Team ${teamId} not found`);
    return team;
  }

  /**
   * Tenant isolation guard: without this, an org admin could pass another
   * organization's userId as a team member (create's memberIds, or
   * addMember/removeMember) and the insert/delete would succeed silently
   * since team_members has no FK tying it back to the team's organization.
   */
  private async requireUsersInOrganization(organizationId: string, userIds: string[]) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), inArray(users.id, userIds)));
    const found = new Set(rows.map((r) => r.id));
    const missing = userIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`User(s) not found in organization: ${missing.join(", ")}`);
    }
  }
}
