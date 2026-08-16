import { computeLeadScore, evaluateRule, isBusinessEmail, type LeadScoringFields, type LeadScoringRuleLike } from "./evaluate-lead-score";

function lead(overrides: Partial<LeadScoringFields> = {}): LeadScoringFields {
  return { companySize: null, email: null, source: null, industry: null, estimatedValue: null, ...overrides };
}

function rule(overrides: Partial<LeadScoringRuleLike> = {}): LeadScoringRuleLike {
  return { field: "source", operator: "equals", value: "website", points: 10, active: true, ...overrides };
}

describe("isBusinessEmail", () => {
  it("treats a free consumer provider as not a business email", () => {
    expect(isBusinessEmail("jane@gmail.com")).toBe(false);
  });

  it("treats a non-consumer domain as a business email", () => {
    expect(isBusinessEmail("jane@acme.com")).toBe(true);
  });

  it("returns false for null/malformed email", () => {
    expect(isBusinessEmail(null)).toBe(false);
    expect(isBusinessEmail("not-an-email")).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("equals: matches on exact field value", () => {
    expect(evaluateRule(rule({ field: "industry", operator: "equals", value: "SaaS" }), lead({ industry: "SaaS" }))).toBe(true);
    expect(evaluateRule(rule({ field: "industry", operator: "equals", value: "SaaS" }), lead({ industry: "Retail" }))).toBe(false);
  });

  it("in: matches when field value is one of the given options", () => {
    const r = rule({ field: "companySize", operator: "in", value: ["201-1000", "1000+"] });
    expect(evaluateRule(r, lead({ companySize: "1000+" }))).toBe(true);
    expect(evaluateRule(r, lead({ companySize: "1-10" }))).toBe(false);
  });

  it("greaterThan / lessThan: numeric comparisons on estimatedValue", () => {
    const gt = rule({ field: "estimatedValue", operator: "greaterThan", value: 50000 });
    expect(evaluateRule(gt, lead({ estimatedValue: 75000 }))).toBe(true);
    expect(evaluateRule(gt, lead({ estimatedValue: 10000 }))).toBe(false);

    const lt = rule({ field: "estimatedValue", operator: "lessThan", value: 50000 });
    expect(evaluateRule(lt, lead({ estimatedValue: 10000 }))).toBe(true);
  });

  it("isBusinessEmail: ignores the rule's field/value and checks the lead's email", () => {
    const r = rule({ field: "email", operator: "isBusinessEmail", value: null });
    expect(evaluateRule(r, lead({ email: "jane@acme.com" }))).toBe(true);
    expect(evaluateRule(r, lead({ email: "jane@gmail.com" }))).toBe(false);
  });

  it("returns false when the referenced field is missing on the lead", () => {
    expect(evaluateRule(rule({ field: "industry", operator: "equals", value: "SaaS" }), lead())).toBe(false);
  });
});

describe("computeLeadScore", () => {
  it("sums points from every matching, active rule", () => {
    const rules = [
      rule({ field: "source", operator: "equals", value: "website", points: 10 }),
      rule({ field: "industry", operator: "equals", value: "SaaS", points: 15 }),
      rule({ field: "estimatedValue", operator: "greaterThan", value: 50000, points: 30 }),
    ];
    const score = computeLeadScore(rules, lead({ source: "website", industry: "SaaS", estimatedValue: 100000 }));
    expect(score).toBe(55);
  });

  it("excludes inactive rules", () => {
    const rules = [rule({ points: 10, active: false })];
    expect(computeLeadScore(rules, lead({ source: "website" }))).toBe(0);
  });

  it("excludes rules that don't match", () => {
    const rules = [rule({ field: "source", operator: "equals", value: "referral", points: 10 })];
    expect(computeLeadScore(rules, lead({ source: "website" }))).toBe(0);
  });

  it("returns 0 for no rules", () => {
    expect(computeLeadScore([], lead())).toBe(0);
  });
});
