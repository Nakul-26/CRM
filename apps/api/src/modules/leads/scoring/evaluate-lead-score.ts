import type { LeadScoringField, LeadScoringOperator } from "@sales-platform/contracts";

/** Consumer email providers that don't count as a "business email" signal. */
const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "protonmail.com",
  "live.com",
]);

export function isBusinessEmail(email: string | null | undefined): boolean {
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return Boolean(domain) && !FREE_EMAIL_PROVIDERS.has(domain);
}

export interface LeadScoringRuleLike {
  field: LeadScoringField;
  operator: LeadScoringOperator;
  value: string | number | string[] | null;
  points: number;
  active: boolean;
}

export interface LeadScoringFields {
  companySize: string | null;
  email: string | null;
  source: string | null;
  industry: string | null;
  estimatedValue: number | null;
}

/** Pure, DB-free — see evaluate-lead-score.spec.ts. Unit-testable per brief §30 ("lead scoring"). */
export function evaluateRule(rule: LeadScoringRuleLike, lead: LeadScoringFields): boolean {
  if (rule.operator === "isBusinessEmail") return isBusinessEmail(lead.email);

  const fieldValue = lead[rule.field];
  if (fieldValue === null || fieldValue === undefined) return false;

  switch (rule.operator) {
    case "equals":
      return String(fieldValue) === String(rule.value);
    case "in":
      return Array.isArray(rule.value) && rule.value.map(String).includes(String(fieldValue));
    case "greaterThan":
      return typeof rule.value === "number" && Number(fieldValue) > rule.value;
    case "lessThan":
      return typeof rule.value === "number" && Number(fieldValue) < rule.value;
    default:
      return false;
  }
}

export function computeLeadScore(rules: LeadScoringRuleLike[], lead: LeadScoringFields): number {
  return rules
    .filter((rule) => rule.active)
    .filter((rule) => evaluateRule(rule, lead))
    .reduce((sum, rule) => sum + rule.points, 0);
}
