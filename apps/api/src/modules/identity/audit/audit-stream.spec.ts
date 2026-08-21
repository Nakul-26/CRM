import { matchesAuditStreamFilters, type AuditStreamEvent } from "./audit-stream";

function makeEvent(overrides: Partial<AuditStreamEvent> = {}): AuditStreamEvent {
  return {
    organizationId: "org-1",
    eventType: "account.created",
    actorId: "user-1",
    createdAt: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("matchesAuditStreamFilters", () => {
  it("matches when no filters are set", () => {
    expect(matchesAuditStreamFilters(makeEvent(), {})).toBe(true);
  });

  it("matches on eventType", () => {
    expect(matchesAuditStreamFilters(makeEvent({ eventType: "opportunity.won" }), { eventType: "opportunity.won" })).toBe(true);
  });

  it("rejects a different eventType", () => {
    expect(matchesAuditStreamFilters(makeEvent({ eventType: "account.created" }), { eventType: "opportunity.won" })).toBe(false);
  });

  it("matches on actorId", () => {
    expect(matchesAuditStreamFilters(makeEvent({ actorId: "user-2" }), { actorId: "user-2" })).toBe(true);
  });

  it("rejects a different actorId", () => {
    expect(matchesAuditStreamFilters(makeEvent({ actorId: "user-1" }), { actorId: "user-2" })).toBe(false);
  });

  it("rejects a system event (null actorId) when actorId filter is set", () => {
    expect(matchesAuditStreamFilters(makeEvent({ actorId: null }), { actorId: "user-2" })).toBe(false);
  });

  it("matches when createdAt is within the dateFrom/dateTo range", () => {
    const event = makeEvent({ createdAt: "2026-08-21T12:00:00.000Z" });
    expect(matchesAuditStreamFilters(event, { dateFrom: "2026-08-21T00:00:00.000Z", dateTo: "2026-08-21T23:59:59.000Z" })).toBe(true);
  });

  it("rejects when createdAt is before dateFrom", () => {
    const event = makeEvent({ createdAt: "2026-08-20T12:00:00.000Z" });
    expect(matchesAuditStreamFilters(event, { dateFrom: "2026-08-21T00:00:00.000Z" })).toBe(false);
  });

  it("rejects when createdAt is after dateTo", () => {
    const event = makeEvent({ createdAt: "2026-08-22T12:00:00.000Z" });
    expect(matchesAuditStreamFilters(event, { dateTo: "2026-08-21T23:59:59.000Z" })).toBe(false);
  });

  it("requires every set filter to match at once", () => {
    const event = makeEvent({ eventType: "opportunity.won", actorId: "user-1", createdAt: "2026-08-21T12:00:00.000Z" });
    expect(
      matchesAuditStreamFilters(event, {
        eventType: "opportunity.won",
        actorId: "user-1",
        dateFrom: "2026-08-21T00:00:00.000Z",
        dateTo: "2026-08-21T23:59:59.000Z",
      }),
    ).toBe(true);
    expect(
      matchesAuditStreamFilters(event, {
        eventType: "opportunity.won",
        actorId: "user-2",
        dateFrom: "2026-08-21T00:00:00.000Z",
        dateTo: "2026-08-21T23:59:59.000Z",
      }),
    ).toBe(false);
  });
});
