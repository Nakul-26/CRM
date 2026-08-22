import { ConfigService } from "@nestjs/config";
import { DunningScheduler } from "./dunning.scheduler";
import type { DunningActionsService } from "./dunning-actions.service";

function makeConfig(engine: "in-process" | "temporal") {
  return { get: () => engine } as unknown as ConfigService<never, true>;
}

type DueCycle = { cycleId: string; organizationId: string; subscriptionId: string; latestPaymentId: string | null };

function makeDb(dueCycles: DueCycle[], paymentCreatedBy: string | null) {
  const dueWhere = jest.fn().mockResolvedValue(
    dueCycles.map((c) => ({ cycleId: c.cycleId, organizationId: c.organizationId, subscriptionId: c.subscriptionId, latestPaymentId: c.latestPaymentId })),
  );
  const paymentLimit = jest.fn().mockResolvedValue(paymentCreatedBy ? [{ createdBy: paymentCreatedBy }] : []);
  const paymentWhere = jest.fn().mockReturnValue({ limit: paymentLimit });

  let selectCallCount = 0;
  const select = jest.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // the "due cycles" query — no .limit(), resolves directly off .where()
      return { from: jest.fn().mockReturnValue({ where: dueWhere }) };
    }
    return { from: jest.fn().mockReturnValue({ where: paymentWhere }) };
  });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  return { db: { select, update } as never, set, updateWhere };
}

function makeActions() {
  return { attemptCharge: jest.fn().mockResolvedValue({ paymentId: "pay_new" }) } as unknown as DunningActionsService;
}

describe("DunningScheduler", () => {
  it("processDueCycles fires an attempt for each due, waiting cycle", async () => {
    const { db, set } = makeDb([{ cycleId: "cycle_1", organizationId: "org_1", subscriptionId: "sub_1", latestPaymentId: "pay_1" }], "user_1");
    const actions = makeActions();
    const scheduler = new DunningScheduler(db, actions, makeConfig("in-process"));

    const count = await scheduler.processDueCycles();

    expect(count).toBe(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "attempting" }));
    expect(actions.attemptCharge).toHaveBeenCalledWith("org_1", "user_1", "sub_1");
  });

  it("skips a due cycle whose payment/actor can no longer be resolved", async () => {
    const { db } = makeDb([{ cycleId: "cycle_1", organizationId: "org_1", subscriptionId: "sub_1", latestPaymentId: null }], null);
    const actions = makeActions();
    const scheduler = new DunningScheduler(db, actions, makeConfig("in-process"));

    await scheduler.processDueCycles();

    expect(actions.attemptCharge).not.toHaveBeenCalled();
  });

  it("handleCron does nothing when WORKFLOW_ENGINE is temporal (Temporal drives its own retries)", async () => {
    const { db } = makeDb([{ cycleId: "cycle_1", organizationId: "org_1", subscriptionId: "sub_1", latestPaymentId: "pay_1" }], "user_1");
    const actions = makeActions();
    const scheduler = new DunningScheduler(db, actions, makeConfig("temporal"));

    await scheduler.handleCron();

    expect(actions.attemptCharge).not.toHaveBeenCalled();
  });

  it("swallows errors for one cycle without aborting the rest of the batch", async () => {
    const { db } = makeDb(
      [
        { cycleId: "cycle_1", organizationId: "org_1", subscriptionId: "sub_1", latestPaymentId: "pay_1" },
      ],
      "user_1",
    );
    const actions = { attemptCharge: jest.fn().mockRejectedValue(new Error("provider down")) } as unknown as DunningActionsService;
    const scheduler = new DunningScheduler(db, actions, makeConfig("in-process"));

    await expect(scheduler.processDueCycles()).resolves.toBe(1);
  });
});
