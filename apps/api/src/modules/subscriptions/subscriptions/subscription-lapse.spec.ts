import { isLapseDue, type SubscriptionLapseInput } from "./subscription-lapse";

const NOW = new Date("2026-08-16T12:00:00Z");

function subscription(overrides: Partial<SubscriptionLapseInput> = {}): SubscriptionLapseInput {
  return { status: "active", currentPeriodEnd: new Date("2026-09-16T12:00:00Z"), ...overrides };
}

describe("isLapseDue", () => {
  it("is not due while active and the period hasn't ended", () => {
    expect(isLapseDue(subscription({ currentPeriodEnd: new Date("2026-09-16T12:00:00Z") }), NOW)).toBe(false);
  });

  it("is due once active and the period has ended", () => {
    expect(isLapseDue(subscription({ currentPeriodEnd: new Date("2026-08-01T00:00:00Z") }), NOW)).toBe(true);
  });

  it("is never due once already lapsed, even with a past period end", () => {
    expect(isLapseDue(subscription({ status: "lapsed", currentPeriodEnd: new Date("2026-08-01T00:00:00Z") }), NOW)).toBe(false);
  });

  it("is never due once cancelled, even with a past period end", () => {
    expect(isLapseDue(subscription({ status: "cancelled", currentPeriodEnd: new Date("2026-08-01T00:00:00Z") }), NOW)).toBe(false);
  });
});
