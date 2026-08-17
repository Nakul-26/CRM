import type { TicketStatus } from "@sales-platform/contracts";

export interface TicketSlaInput {
  status: TicketStatus;
  firstResponseDueAt: Date | null;
  firstRespondedAt: Date | null;
  resolutionDueAt: Date | null;
}

export interface TicketSlaFlags {
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
}

/**
 * Pure, read-time computation of SLA breach flags — never persisted (see
 * docs/decisions/0006-support-phase6-scope.md). A breach here doesn't gate
 * any transition, unlike quote expiry, so there's nothing to touch-and-save.
 */
export function computeTicketSlaFlags(ticket: TicketSlaInput, now: Date): TicketSlaFlags {
  const firstResponseBreached = Boolean(
    ticket.firstResponseDueAt && !ticket.firstRespondedAt && now > ticket.firstResponseDueAt,
  );

  const resolutionBreached = Boolean(
    ticket.resolutionDueAt && ticket.status !== "resolved" && ticket.status !== "closed" && now > ticket.resolutionDueAt,
  );

  return { firstResponseBreached, resolutionBreached };
}
