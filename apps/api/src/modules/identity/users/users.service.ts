import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ERROR_CODES, type InviteUserInput } from "@sales-platform/contracts";
import { DATABASE_CONNECTION, type Database, type Db } from "../../../database/database.module";
import { users, userRoles, roles } from "../../../database/schema";
import { DomainEventBus } from "../../../shared/events/domain-event-bus";
import { PasswordService } from "../auth/password.service";
import { RolesService } from "../roles/roles.service";

export interface CreateUserInput {
  organizationId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  createdBy?: string;
}

export interface SafeUser {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
}

export interface InvitedUserResult {
  user: SafeUser;
  temporaryPassword: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly roles: RolesService,
    private readonly events: DomainEventBus,
  ) {}

  async create(input: CreateUserInput, tx: Db = this.db) {
    const [user] = await tx
      .insert(users)
      .values({
        organizationId: input.organizationId,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        createdBy: input.createdBy,
      })
      .returning();
    return user;
  }

  async findByEmailInOrg(organizationId: string, email: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.email, email)))
      .limit(1);
    return user;
  }

  /** Email is only unique per-organization, so login must know which org to look in. */
  async findByEmailAcrossOrgs(email: string) {
    return this.db.select().from(users).where(eq(users.email, email));
  }

  async findById(organizationId: string, userId: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  async findByIdUnscoped(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user;
  }

  async listForOrganization(organizationId: string) {
    const rows = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        email: users.email,
        fullName: users.fullName,
        isActive: users.isActive,
        createdAt: users.createdAt,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.organizationId, organizationId));

    const byUser = new Map<string, { id: string; organizationId: string; email: string; fullName: string; isActive: boolean; createdAt: Date; roles: string[] }>();
    for (const row of rows) {
      const existing = byUser.get(row.id);
      if (existing) {
        if (row.roleName) existing.roles.push(row.roleName);
      } else {
        byUser.set(row.id, {
          id: row.id,
          organizationId: row.organizationId,
          email: row.email,
          fullName: row.fullName,
          isActive: row.isActive,
          createdAt: row.createdAt,
          roles: row.roleName ? [row.roleName] : [],
        });
      }
    }
    return [...byUser.values()];
  }

  async invite(organizationId: string, invitedBy: string, input: InviteUserInput): Promise<InvitedUserResult> {
    const existing = await this.findByEmailInOrg(organizationId, input.email);
    if (existing) {
      throw new ConflictException({
        code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        message: `${input.email} is already a member of this organization`,
      });
    }

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const user = await this.db.transaction(async (tx) => {
      const created = await this.create(
        { organizationId, email: input.email, passwordHash, fullName: input.fullName, createdBy: invitedBy },
        tx,
      );
      for (const roleId of input.roleIds) {
        await this.roles.requireRole(organizationId, roleId);
        await tx.insert(userRoles).values({ userId: created.id, roleId });
      }
      return created;
    });

    this.events.publish({
      eventType: "user.invited",
      organizationId,
      actorId: invitedBy,
      payload: { userId: user.id, email: user.email, invitedBy },
    });

    // Never return passwordHash to the API — this bit us during manual
    // testing: the raw bcrypt hash was going straight into the HTTP response.
    const { passwordHash: _passwordHash, updatedBy: _updatedBy, deletedAt: _deletedAt, ...safeUser } = user;
    return { user: safeUser, temporaryPassword };
  }

  async deactivate(organizationId: string, userId: string, deactivatedBy: string) {
    // findById throws NotFoundException if userId doesn't belong to
    // organizationId — without this check first, the update below would
    // silently affect zero rows for a cross-tenant id and still report
    // success (and still publish an audit event claiming it happened).
    await this.findById(organizationId, userId);

    await this.db
      .update(users)
      .set({ isActive: false, updatedAt: new Date(), updatedBy: deactivatedBy })
      .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)));

    this.events.publish({
      eventType: "user.deactivated",
      organizationId,
      actorId: deactivatedBy,
      payload: { userId },
    });
  }
}
