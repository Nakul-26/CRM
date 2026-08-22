import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NativeConnection, Worker } from "@temporalio/worker";
import type { ApiEnv } from "@sales-platform/config";
import { DunningActionsService } from "./dunning-actions.service";
import { DUNNING_TASK_QUEUE } from "./orchestrators/temporal-dunning.orchestrator";
import { createDunningActivities } from "./workflows/dunning.activities";

/**
 * Runs the Temporal Worker in the same process as the rest of the API —
 * matches this app's modular-monolith architecture (ADR 0001); splitting it
 * into its own deployment is exactly the kind of change the eventual
 * microservices-split phase would make, not this one. Only started when
 * WORKFLOW_ENGINE=temporal. See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
@Injectable()
export class TemporalWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalWorkerService.name);
  private worker: Worker | undefined;
  private connection: NativeConnection | undefined;

  constructor(
    private readonly config: ConfigService<ApiEnv, true>,
    private readonly actions: DunningActionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get("WORKFLOW_ENGINE", { infer: true }) !== "temporal") return;

    const address = this.config.get("TEMPORAL_ADDRESS", { infer: true });
    if (!address) {
      this.logger.error("WORKFLOW_ENGINE=temporal requires TEMPORAL_ADDRESS to be set — worker not started");
      return;
    }
    const namespace = this.config.get("TEMPORAL_NAMESPACE", { infer: true }) ?? "default";

    try {
      this.connection = await NativeConnection.connect({ address });
      this.worker = await Worker.create({
        connection: this.connection,
        namespace,
        taskQueue: DUNNING_TASK_QUEUE,
        workflowsPath: require.resolve("./workflows/dunning.workflow"),
        activities: createDunningActivities(this.actions),
      });

      // Fire-and-forget, same non-blocking-bootstrap idiom as
      // AuditListener's RabbitMQ consumer start — worker.run() only
      // resolves once the worker is shut down.
      void this.worker.run().catch((error) => this.logger.error("Temporal worker stopped unexpectedly", error as Error));
      this.logger.log(`Temporal worker started (task queue: ${DUNNING_TASK_QUEUE})`);
    } catch (error) {
      this.logger.error("Failed to start Temporal worker", error as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.worker?.shutdown();
    await this.connection?.close().catch(() => undefined);
  }
}
