import type { DomainEvent } from "@sales-platform/contracts";
import { DunningListener } from "./dunning.listener";
import type { DunningOrchestrator } from "./orchestrators/dunning-orchestrator.interface";
import type { PostgresDunningOrchestrator } from "./orchestrators/postgres-dunning.orchestrator";

function makeOrchestrator(kind: "in-process" | "temporal", hasActiveCycle: boolean): DunningOrchestrator {
  return {
    kind,
    hasActiveCycle: jest.fn().mockResolvedValue(hasActiveCycle),
    startDunning: jest.fn().mockResolvedValue(undefined),
    recordAttemptOutcome: jest.fn().mockResolvedValue(undefined),
  };
}

function failedEvent(): DomainEvent<"payment.failed", { paymentId: string; subscriptionId: string; recipientId: string }> {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    eventType: "payment.failed",
    timestamp: "2026-08-22T00:00:00.000Z",
    organizationId: "org_1",
    correlationId: "22222222-2222-2222-2222-222222222222",
    payload: { paymentId: "pay_1", subscriptionId: "sub_1", recipientId: "user_1" },
  };
}

function succeededEvent(): DomainEvent<"payment.succeeded", { paymentId: string; subscriptionId: string; accountId: string; amount: number; recipientId: string }> {
  return {
    eventId: "33333333-3333-3333-3333-333333333333",
    eventType: "payment.succeeded",
    timestamp: "2026-08-22T00:00:00.000Z",
    organizationId: "org_1",
    correlationId: "44444444-4444-4444-4444-444444444444",
    payload: { paymentId: "pay_2", subscriptionId: "sub_1", accountId: "acc_1", amount: 10, recipientId: "user_1" },
  };
}

describe("DunningListener", () => {
  it("starts a new cycle on the first payment.failed for a subscription", async () => {
    const orchestrator = makeOrchestrator("in-process", false);
    const listener = new DunningListener(orchestrator, {} as unknown as PostgresDunningOrchestrator);

    await listener.onPaymentFailed(failedEvent());

    expect(orchestrator.startDunning).toHaveBeenCalledWith({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" });
    expect(orchestrator.recordAttemptOutcome).not.toHaveBeenCalled();
  });

  it("reports a failed outcome instead of starting a new cycle when one is already active", async () => {
    const orchestrator = makeOrchestrator("in-process", true);
    const listener = new DunningListener(orchestrator, {} as unknown as PostgresDunningOrchestrator);

    await listener.onPaymentFailed(failedEvent());

    expect(orchestrator.recordAttemptOutcome).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorId: "user_1",
      subscriptionId: "sub_1",
      paymentId: "pay_1",
      succeeded: false,
    });
    expect(orchestrator.startDunning).not.toHaveBeenCalled();
  });

  it("resolves an active cycle on payment.succeeded", async () => {
    const orchestrator = makeOrchestrator("in-process", true);
    const listener = new DunningListener(orchestrator, {} as unknown as PostgresDunningOrchestrator);

    await listener.onPaymentSucceeded(succeededEvent());

    expect(orchestrator.recordAttemptOutcome).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorId: "user_1",
      subscriptionId: "sub_1",
      paymentId: "pay_2",
      succeeded: true,
    });
  });

  it("ignores payment.succeeded when there is no active dunning cycle", async () => {
    const orchestrator = makeOrchestrator("in-process", false);
    const listener = new DunningListener(orchestrator, {} as unknown as PostgresDunningOrchestrator);

    await listener.onPaymentSucceeded(succeededEvent());

    expect(orchestrator.recordAttemptOutcome).not.toHaveBeenCalled();
  });

  it("falls back to the Postgres orchestrator's own decision when the Temporal orchestrator fails", async () => {
    const temporal = makeOrchestrator("temporal", false);
    (temporal.hasActiveCycle as jest.Mock).mockRejectedValue(new Error("temporal down"));
    const postgresFallback = {
      hasActiveCycle: jest.fn().mockResolvedValue(false),
      startDunning: jest.fn().mockResolvedValue(undefined),
      recordAttemptOutcome: jest.fn(),
    } as unknown as PostgresDunningOrchestrator;
    const listener = new DunningListener(temporal, postgresFallback);

    await listener.onPaymentFailed(failedEvent());

    expect(postgresFallback.startDunning).toHaveBeenCalledWith({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" });
  });

  it("does not fall back when the Temporal orchestrator succeeds", async () => {
    const temporal = makeOrchestrator("temporal", false);
    const postgresFallback = { hasActiveCycle: jest.fn(), startDunning: jest.fn() } as unknown as PostgresDunningOrchestrator;
    const listener = new DunningListener(temporal, postgresFallback);

    await listener.onPaymentFailed(failedEvent());

    expect(postgresFallback.startDunning).not.toHaveBeenCalled();
  });

  it("swallows errors entirely if both the active and fallback orchestrators fail (never breaks payment handling)", async () => {
    const temporal = makeOrchestrator("temporal", false);
    (temporal.hasActiveCycle as jest.Mock).mockRejectedValue(new Error("temporal down"));
    const postgresFallback = {
      hasActiveCycle: jest.fn().mockRejectedValue(new Error("db down")),
      startDunning: jest.fn(),
    } as unknown as PostgresDunningOrchestrator;
    const listener = new DunningListener(temporal, postgresFallback);

    await expect(listener.onPaymentFailed(failedEvent())).resolves.toBeUndefined();
  });
});
