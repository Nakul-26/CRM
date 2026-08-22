import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client, Connection, WorkflowNotFoundError, type WorkflowClient } from "@temporalio/client";
import type { ApiEnv } from "@sales-platform/config";
import { getDunningRetryDelaysMs } from "../dunning-policy";
import { dunningWorkflow, paymentResolvedSignal, type DunningWorkflowInput } from "../workflows/dunning.workflow";
import type { DunningAttemptOutcomeInput, DunningCycleInput, DunningOrchestrator } from "./dunning-orchestrator.interface";

export const DUNNING_TASK_QUEUE = "dunning";

function workflowId(subscriptionId: string): string {
  return `dunning:${subscriptionId}`;
}

/**
 * Waiting/retrying is driven by a real Temporal workflow — durable, survives
 * process restarts, natively expresses "sleep days, retry, cancel on
 * exhaustion." Only ever touched when WORKFLOW_ENGINE=temporal; the client
 * connection is built lazily on first use, mirroring
 * RabbitMQAuditTransport's lazy-connection idiom. See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
@Injectable()
export class TemporalDunningOrchestrator implements DunningOrchestrator {
  readonly kind = "temporal" as const;
  private readonly logger = new Logger(TemporalDunningOrchestrator.name);

  private client: WorkflowClient | undefined;
  private connecting: Promise<WorkflowClient> | undefined;

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  /**
   * The workflow's own execution state is the source of truth — no shadow
   * bookkeeping table needed. A RUNNING execution means dunning is already
   * in flight for this subscription; anything else (not found, completed,
   * cancelled...) means a fresh cycle should start.
   */
  async hasActiveCycle(subscriptionId: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      const description = await client.getHandle(workflowId(subscriptionId)).describe();
      return description.status.name === "RUNNING";
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return false;
      throw error;
    }
  }

  async startDunning(input: DunningCycleInput): Promise<void> {
    const client = await this.getClient();
    const retryDelaysMs = getDunningRetryDelaysMs(this.config.get("DUNNING_RETRY_DELAYS_MS", { infer: true }));

    const workflowInput: DunningWorkflowInput = {
      organizationId: input.organizationId,
      actorId: input.actorId,
      subscriptionId: input.subscriptionId,
      initialPaymentId: input.paymentId,
      retryDelaysMs,
    };

    await client.start(dunningWorkflow, {
      taskQueue: DUNNING_TASK_QUEUE,
      workflowId: workflowId(input.subscriptionId),
      // Idempotent: WorkflowIdReusePolicy defaults to rejecting a duplicate
      // start for an already-running workflow ID — a second payment.failed
      // for a subscription already being dunned is a safe no-op.
      args: [workflowInput],
    });
  }

  async recordAttemptOutcome(input: DunningAttemptOutcomeInput): Promise<void> {
    const client = await this.getClient();
    const handle = client.getHandle(workflowId(input.subscriptionId));
    await handle.signal(paymentResolvedSignal, { paymentId: input.paymentId, succeeded: input.succeeded });
  }

  private async getClient(): Promise<WorkflowClient> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    const address = this.config.get("TEMPORAL_ADDRESS", { infer: true });
    if (!address) {
      throw new Error("WORKFLOW_ENGINE=temporal requires TEMPORAL_ADDRESS to be set");
    }
    const namespace = this.config.get("TEMPORAL_NAMESPACE", { infer: true }) ?? "default";

    this.connecting = Connection.connect({ address })
      .then((connection) => {
        const client = new Client({ connection, namespace }).workflow;
        this.client = client;
        return client;
      })
      .catch((error) => {
        this.logger.error("Failed to connect to Temporal", error as Error);
        throw error;
      })
      .finally(() => {
        this.connecting = undefined;
      });

    return this.connecting;
  }
}
