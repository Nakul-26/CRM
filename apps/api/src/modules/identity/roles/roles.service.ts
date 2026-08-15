import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, type CreateRoleInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database, type Db } from "../../../database/database.module";
import { roles, userRoles, users } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";

@Injectable()
export class RolesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly events: DomainEventBus,
  ) {}

  /** Called once, inside the registration transaction, when an org is created. */
  async seedSystemRoles(organizationId: string, tx: Db = this.db) {
    const rows = await tx
      .insert(roles)
      .values(
        Object.values(SYSTEM_ROLES).map((name) => ({
          organizationId,
          name,
          isSystemRole: true,
          permissions: [...SYSTEM_ROLE_PERMISSIONS[name]],
        })),
      )
      .returning();

    const byName = new Map(rows.map((r) => [r.name, r]));
    return {
      owner: byName.get(SYSTEM_ROLES.OWNER)!,
      admin: byName.get(SYSTEM_ROLES.ADMIN)!,
      member: byName.get(SYSTEM_ROLES.MEMBER)!,
    };
  }

  async listForOrganization(organizationId: string) {
    return this.db.select().from(roles).where(eq(roles.organizationId, organizationId));
  }

  async findByIds(organizationId: string, roleIds: string[]) {
    if (roleIds.length === 0) return [];
    return this.db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), inArray(roles.id, roleIds)));
  }

  async create(organizationId: string, input: CreateRoleInput) {
    const [role] = await this.db
      .insert(roles)
      .values({ organizationId, name: input.name, permissions: input.permissions, isSystemRole: false })
      .returning();
    return role;
  }

  async assignToUser(organizationId: string, actorId: string, userId: string, roleId: string) {
    await this.requireRole(organizationId, roleId);
    await this.requireUserInOrganization(organizationId, userId);
    await this.db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
    this.events.publish({
      eventType: "user.role_assigned",
      organizationId,
      actorId,
      payload: { userId, roleId },
    });
  }

  async revokeFromUser(organizationId: string, actorId: string, userId: string, roleId: string) {
    await this.requireRole(organizationId, roleId);
    await this.requireUserInOrganization(organizationId, userId);
    await this.db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    this.events.publish({
      eventType: "user.role_revoked",
      organizationId,
      actorId,
      payload: { userId, roleId },
    });
  }

  async permissionsForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ permissions: roles.permissions })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    const merged = new Set<string>();
    for (const row of rows) {
      for (const permission of row.permissions ?? []) merged.add(permission);
    }
    return [...merged];
  }

  async requireRole(organizationId: string, roleId: string) {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.id, roleId)))
      .limit(1);
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);
    return role;
  }

  /**
   * Tenant isolation guard: without this, an admin in org B could pass an
   * org A user's id here (roles.assignToUser only validated the *role*
   * belonged to org B, not that the *user* did) and attach org B
   * permissions to a user in a completely different organization.
   */
  private async requireUserInOrganization(organizationId: string, userId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
  }
}
