/**
 * Permission-based authorization (Section 19 of the product brief).
 * Roles are just named bundles of these strings — never branch on role name.
 */
export const PERMISSIONS = [
  // Identity & administration
  "identity.organization.manage",
  "identity.users.view",
  "identity.users.invite",
  "identity.users.edit",
  "identity.users.deactivate",
  "identity.teams.view",
  "identity.teams.manage",
  "identity.roles.view",
  "identity.roles.manage",
  "audit.log.view",

  // Domains added in later phases — reserved here so role/permission
  // seeding and the RBAC UI don't need a breaking change to grow into them.
  "crm.accounts.view",
  "crm.accounts.create",
  "crm.accounts.edit",
  "crm.accounts.delete",
  "crm.contacts.view",
  "crm.contacts.create",
  "crm.contacts.edit",
  "crm.contacts.delete",
  "crm.activities.view",
  "crm.activities.create",
  "crm.activities.edit",
  "crm.activities.delete",
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.convert",
  "opportunities.view",
  "opportunities.create",
  "opportunities.edit",
  "quotes.view",
  "quotes.create",
  "quotes.send",
  "quotes.accept",
  "support.tickets.view",
  "support.tickets.create",
  "support.tickets.manage",
  "subscriptions.view",
  "subscriptions.create",
  "subscriptions.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Permission bundles granted to each seeded system role on org creation. */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  [SYSTEM_ROLES.OWNER]: PERMISSIONS,
  [SYSTEM_ROLES.ADMIN]: PERMISSIONS.filter((p) => p !== "identity.organization.manage"),
  [SYSTEM_ROLES.MEMBER]: [
    "crm.accounts.view",
    "crm.accounts.create",
    "crm.accounts.edit",
    "crm.contacts.view",
    "crm.contacts.create",
    "crm.contacts.edit",
    "crm.activities.view",
    "crm.activities.create",
    "crm.activities.edit",
    "leads.view",
    "leads.create",
    "opportunities.view",
    "opportunities.create",
    "quotes.view",
    "quotes.create",
    "support.tickets.view",
    "support.tickets.create",
    "subscriptions.view",
  ],
};
