import { randomUUID } from "node:crypto";
import {
  boolean,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * One Postgres schema per domain module (see docs/architecture/overview.md).
 * The `identity` module owns everything under the `identity` schema; no
 * other module may reference these tables directly.
 */
export const identitySchema = pgSchema("identity");

export const organizations = identitySchema.table("organizations", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = identitySchema.table(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // Tenant isolation at the schema level: an email is unique per
    // organization, not globally — two orgs may each have their own
    // owner@theircompany.com.
    orgEmailUnique: uniqueIndex("users_org_email_unique").on(table.organizationId, table.email),
  }),
);

export const roles = identitySchema.table(
  "roles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isSystemRole: boolean("is_system_role").notNull().default(false),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgNameUnique: uniqueIndex("roles_org_name_unique").on(table.organizationId, table.name),
  }),
);

export const userRoles = identitySchema.table(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
  }),
);

export const teams = identitySchema.table("teams", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = identitySchema.table(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.userId] }),
  }),
);

/**
 * Hashed, rotating refresh tokens. The raw token is only ever returned to
 * the client once, at issuance — we store a hash so a leaked database
 * dump doesn't hand out live sessions.
 */
export const refreshTokens = identitySchema.table(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("refresh_tokens_token_hash_unique").on(table.tokenHash),
  }),
);

/**
 * Append-only. Populated by the domain-event audit listener
 * (src/shared/audit) — never updated or deleted from application code.
 */
export const auditLog = identitySchema.table("audit_log", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  organizationId: uuid("organization_id").notNull(),
  actorId: uuid("actor_id"),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  requestId: text("request_id"),
  correlationId: text("correlation_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  roles: many(roles),
  teams: many(teams),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  userRoles: many(userRoles),
  teamMembers: many(teamMembers),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [roles.organizationId],
    references: [organizations.id],
  }),
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [teams.organizationId],
    references: [organizations.id],
  }),
  teamMembers: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));
