import { computeTicketSlaFlags, type TicketSlaInput } from "./ticket-sla";

const NOW = new Date("2026-08-16T12:00:00Z");

function ticket(overrides: Partial<TicketSlaInput> = {}): TicketSlaInput {
  return { status: "open", firstResponseDueAt: null, firstRespondedAt: null, resolutionDueAt: null, ...overrides };
}

describe("computeTicketSlaFlags", () => {
  it("is not breached when no SLA policy applies (dueAt fields null)", () => {
    expect(computeTicketSlaFlags(ticket(), NOW)).toEqual({ firstResponseBreached: false, resolutionBreached: false });
  });

  it("flags a first-response breach once the due date has passed with no response yet", () => {
    const past = new Date("2026-08-16T10:00:00Z");
    const future = new Date("2026-08-16T14:00:00Z");
    expect(computeTicketSlaFlags(ticket({ firstResponseDueAt: past }), NOW).firstResponseBreached).toBe(true);
    expect(computeTicketSlaFlags(ticket({ firstResponseDueAt: future }), NOW).firstResponseBreached).toBe(false);
  });

  it("does not flag a first-response breach once a response has been recorded, even after the due date", () => {
    const past = new Date("2026-08-16T10:00:00Z");
    expect(
      computeTicketSlaFlags(ticket({ firstResponseDueAt: past, firstRespondedAt: new Date("2026-08-16T11:00:00Z") }), NOW)
        .firstResponseBreached,
    ).toBe(false);
  });

  it("flags a resolution breach once the due date has passed while still open/in_progress", () => {
    const past = new Date("2026-08-16T10:00:00Z");
    expect(computeTicketSlaFlags(ticket({ status: "open", resolutionDueAt: past }), NOW).resolutionBreached).toBe(true);
    expect(computeTicketSlaFlags(ticket({ status: "in_progress", resolutionDueAt: past }), NOW).resolutionBreached).toBe(true);
  });

  it("does not flag a resolution breach once the ticket is resolved or closed, regardless of the due date", () => {
    const past = new Date("2026-08-16T10:00:00Z");
    expect(computeTicketSlaFlags(ticket({ status: "resolved", resolutionDueAt: past }), NOW).resolutionBreached).toBe(false);
    expect(computeTicketSlaFlags(ticket({ status: "closed", resolutionDueAt: past }), NOW).resolutionBreached).toBe(false);
  });

  it("does not flag a resolution breach before the due date", () => {
    const future = new Date("2026-08-16T14:00:00Z");
    expect(computeTicketSlaFlags(ticket({ status: "open", resolutionDueAt: future }), NOW).resolutionBreached).toBe(false);
  });
});
