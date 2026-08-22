import { ConfigService } from "@nestjs/config";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import { DUNNING_TASK_QUEUE, TemporalDunningOrchestrator } from "./temporal-dunning.orchestrator";

jest.mock("@temporalio/client");

function makeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
}

function makeMockWorkflowClient() {
  const handle = { signal: jest.fn().mockResolvedValue(undefined), describe: jest.fn() };
  return { start: jest.fn().mockResolvedValue(undefined), getHandle: jest.fn().mockReturnValue(handle), handle };
}

describe("TemporalDunningOrchestrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Connection.connect as jest.Mock).mockResolvedValue({});
  });

  describe("startDunning", () => {
    it("starts a workflow with a deterministic per-subscription workflow ID", async () => {
      const workflowClient = makeMockWorkflowClient();
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await orchestrator.startDunning({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" });

      expect(workflowClient.start).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          taskQueue: DUNNING_TASK_QUEUE,
          workflowId: "dunning:sub_1",
          args: [expect.objectContaining({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", initialPaymentId: "pay_1" })],
        }),
      );
    });

    it("throws (does not swallow) when TEMPORAL_ADDRESS is not configured — DunningListener is responsible for the fallback", async () => {
      const orchestrator = new TemporalDunningOrchestrator(makeConfig({}));
      await expect(
        orchestrator.startDunning({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_1" }),
      ).rejects.toThrow(/TEMPORAL_ADDRESS/);
    });
  });

  describe("hasActiveCycle", () => {
    it("is true when the workflow's own execution state is RUNNING", async () => {
      const workflowClient = makeMockWorkflowClient();
      workflowClient.handle.describe.mockResolvedValue({ status: { name: "RUNNING" } });
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await expect(orchestrator.hasActiveCycle("sub_1")).resolves.toBe(true);
    });

    it("is false once the workflow has completed", async () => {
      const workflowClient = makeMockWorkflowClient();
      workflowClient.handle.describe.mockResolvedValue({ status: { name: "COMPLETED" } });
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await expect(orchestrator.hasActiveCycle("sub_1")).resolves.toBe(false);
    });

    it("is false (not an error) when no workflow has ever run for this subscription", async () => {
      const workflowClient = makeMockWorkflowClient();
      workflowClient.handle.describe.mockRejectedValue(new WorkflowNotFoundError("not found", "dunning:sub_1", undefined));
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await expect(orchestrator.hasActiveCycle("sub_1")).resolves.toBe(false);
    });

    it("propagates a genuine connection failure rather than treating it as no-active-cycle", async () => {
      const workflowClient = makeMockWorkflowClient();
      workflowClient.handle.describe.mockRejectedValue(new Error("connection refused"));
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await expect(orchestrator.hasActiveCycle("sub_1")).rejects.toThrow("connection refused");
    });
  });

  describe("recordAttemptOutcome", () => {
    it("signals the running workflow for the subscription with the payment outcome", async () => {
      const workflowClient = makeMockWorkflowClient();
      (Client as unknown as jest.Mock).mockImplementation(() => ({ workflow: workflowClient }));

      const orchestrator = new TemporalDunningOrchestrator(makeConfig({ TEMPORAL_ADDRESS: "localhost:7234" }));
      await orchestrator.recordAttemptOutcome({ organizationId: "org_1", actorId: "user_1", subscriptionId: "sub_1", paymentId: "pay_2", succeeded: true });

      expect(workflowClient.getHandle).toHaveBeenCalledWith("dunning:sub_1");
      expect(workflowClient.handle.signal).toHaveBeenCalledWith(expect.anything(), { paymentId: "pay_2", succeeded: true });
    });
  });
});
