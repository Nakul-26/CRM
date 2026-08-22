import { ConfigService } from "@nestjs/config";
import { PostgresDunningOrchestrator } from "./postgres-dunning.orchestrator";
import type { DunningActionsService } from "../dunning-actions.service";

function makeConfig(override?: string) {
  return { get: () => override } as unknown as ConfigService<never, true>;
}

function makeActions() {
  return { cancelSubscription: jest.fn().mockResolvedValue(undefined) } as unknown as DunningActionsService;
}

function makeDb(activeCycle: Record<string, unknown> | undefined) {
  const values = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values });

  const limit = jest.fn().mockResolvedValue(activeCycle ? [activeCycle] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  return { db: { insert, select, update } as never, values, set, updateWhere };
}

describe("PostgresDunningOrchestrator", () => {
  it("hasActiveCycle is true when a waiting/attempting row exists for the subscription", async () => {
    const { db } = makeDb({ id: "cycle_1" });
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig());

    await expect(orchestrator.hasActiveCycle("sub_1")).resolves.toBe(true);
  });

  it("hasActiveCycle is false when there is no active row for the subscription", async () => {
    const { db } = makeDb(undefined);
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig());

    await expect(orchestrator.hasActiveCycle("sub_1")).resolves.toBe(false);
  });

  it("startDunning inserts a new waiting cycle at attempt 1", async () => {
    const { db, values } = makeDb(undefined);
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig());

    await orchestrator.startDunning({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", subscriptionId: "sub_1", latestPaymentId: "pay_1", attemptNumber: 1, status: "waiting" }),
    );
  });

  it("startDunning swallows a duplicate-active-cycle conflict rather than throwing", async () => {
    const { db, values } = makeDb(undefined);
    values.mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig());

    await expect(
      orchestrator.startDunning({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" }),
    ).resolves.toBeUndefined();
  });

  it("recordAttemptOutcome marks the cycle succeeded on a successful outcome", async () => {
    const { db, set, updateWhere } = makeDb({ id: "cycle_1", attemptNumber: 1 });
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig());

    await orchestrator.recordAttemptOutcome({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_2", succeeded: true });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", latestPaymentId: "pay_2" }));
    expect(updateWhere).toHaveBeenCalled();
  });

  it("recordAttemptOutcome schedules the next attempt with the correct backoff when attempts remain", async () => {
    const { db, set } = makeDb({ id: "cycle_1", attemptNumber: 1 });
    const orchestrator = new PostgresDunningOrchestrator(db, makeActions(), makeConfig("1000,2000,3000"));

    const before = Date.now();
    await orchestrator.recordAttemptOutcome({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_2", succeeded: false });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 2, status: "waiting", latestPaymentId: "pay_2", nextAttemptAt: expect.any(Date) }),
    );
    const call = (set as jest.Mock).mock.calls[0][0];
    expect(call.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 2000);
  });

  it("recordAttemptOutcome exhausts and cancels the subscription once attempts are used up", async () => {
    const { db, set } = makeDb({ id: "cycle_1", attemptNumber: 3 });
    const actions = makeActions();
    const orchestrator = new PostgresDunningOrchestrator(db, actions, makeConfig());

    await orchestrator.recordAttemptOutcome({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_4", succeeded: false });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "exhausted" }));
    expect(actions.cancelSubscription).toHaveBeenCalledWith("org_1", "user_1", "sub_1");
  });

  it("recordAttemptOutcome is a no-op when there is no active cycle to update", async () => {
    const { db, set } = makeDb(undefined);
    const actions = makeActions();
    const orchestrator = new PostgresDunningOrchestrator(db, actions, makeConfig());

    await orchestrator.recordAttemptOutcome({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_2", succeeded: true });

    expect(set).not.toHaveBeenCalled();
    expect(actions.cancelSubscription).not.toHaveBeenCalled();
  });
});
