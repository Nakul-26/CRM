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
  "leads.delete",
  "leads.convert",
  "leads.scoring.manage",
  "opportunities.view",
  "opportunities.create",
  "opportunities.edit",
  "opportunities.delete",
  "opportunities.pipelines.manage",
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.delete",
  "quotes.send",
  "quotes.accept",
  "quotes.templates.manage",
  "products.view",
  "products.create",
  "products.edit",
  "products.delete",
  "products.pricing.manage",
  "support.tickets.view",
  "support.tickets.create",
  "support.tickets.edit",
  "support.tickets.delete",
  "support.tickets.manage",
  "support.sla_policies.view",
  "support.sla_policies.manage",
  "support.kb.view",
  "support.kb.create",
  "support.kb.edit",
  "support.kb.delete",
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
    "leads.edit",
    "leads.convert",
    "opportunities.view",
    "opportunities.create",
    "opportunities.edit",
    "quotes.view",
    "quotes.create",
    "quotes.edit",
    "products.view",
    "products.create",
    "products.edit",
    "support.tickets.view",
    "support.tickets.create",
    "support.tickets.edit",
    "support.kb.view",
    "subscriptions.view",
  ],
};
