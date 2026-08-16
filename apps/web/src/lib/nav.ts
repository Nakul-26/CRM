export interface NavItem {
  label: string;
  href: string;
  /** Permission required to see this item; undefined = visible to any authenticated user. */
  permission?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Full information architecture from Section 22 of the brief. Only
 * Administration is wired to real pages in Phase 1 — the rest render as
 * "coming in Phase N" placeholders so the nav (and the mental model of the
 * full product) is visible from day one without faking functionality.
 */
export const NAV_SECTIONS: NavSection[] = [
  { label: "Dashboard", items: [{ label: "Overview", href: "/" }] },
  {
    label: "CRM",
    items: [
      { label: "Accounts", href: "/crm/accounts", permission: "crm.accounts.view" },
      { label: "Contacts", href: "/crm/contacts", permission: "crm.contacts.view" },
      { label: "Activities", href: "/crm/activities", permission: "crm.activities.view" },
    ],
  },
  {
    label: "Leads",
    items: [
      { label: "All Leads", href: "/leads", permission: "leads.view" },
      { label: "Lead Sources", href: "/leads/sources", permission: "leads.view" },
      { label: "Lead Scoring", href: "/leads/scoring", permission: "leads.view" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Opportunities", href: "/sales/opportunities", permission: "opportunities.view" },
      { label: "Pipeline", href: "/sales/pipeline", permission: "opportunities.view" },
      { label: "Forecast", href: "/sales/forecast", permission: "opportunities.view" },
    ],
  },
  {
    label: "Quotations",
    items: [
      { label: "Quotes", href: "/quotes", permission: "quotes.view" },
      { label: "Templates", href: "/quotes/templates", permission: "quotes.view" },
    ],
  },
  {
    label: "Products",
    items: [
      { label: "Products", href: "/products", permission: "products.view" },
      { label: "Pricing", href: "/products/pricing", permission: "products.view" },
    ],
  },
  {
    label: "Support",
    items: [
      { label: "Tickets", href: "/support/tickets" },
      { label: "Knowledge Base", href: "/support/kb" },
      { label: "SLAs", href: "/support/slas" },
    ],
  },
  {
    label: "Subscriptions",
    items: [
      { label: "Subscriptions", href: "/subscriptions" },
      { label: "Plans", href: "/subscriptions/plans" },
      { label: "Renewals", href: "/subscriptions/renewals" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/administration/users", permission: "identity.users.view" },
      { label: "Teams", href: "/administration/teams", permission: "identity.teams.view" },
      { label: "Roles", href: "/administration/roles", permission: "identity.roles.view" },
      { label: "Audit Log", href: "/administration/audit", permission: "audit.log.view" },
    ],
  },
];
