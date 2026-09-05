import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NativeConnection, Worker } from "@temporalio/worker";
import type { ApiEnv } from "@sales-platform/config";
import { DunningActionsService } from "./dunning-actions.service";
import { DUNNING_TASK_QUEUE } from "./orchestrators/temporal-dunning.orchestrator";
import { createDunningActivities } from "./workflows/dunning.activities";

const execFileAsync = promisify(execFile);

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
      const workflowBundleCode = await this.bundleWorkflowCode();
      this.connection = await NativeConnection.connect({ address });
      this.worker = await Worker.create({
        connection: this.connection,
        namespace,
        taskQueue: DUNNING_TASK_QUEUE,
        workflowBundle: { code: workflowBundleCode },
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

  /**
   * Bundles the workflow file in a real, separate `node` process rather
   * than calling `Worker.create({ workflowsPath })` (which webpack-bundles
   * in-process). Required specifically because this same in-process bundle
   * step is reproducibly fragile when run inside Jest's own CommonJS module
   * registry — confirmed empirically by running the identical
   * `bundleWorkflowCode` call standalone (clean, ~25s webpack compile) vs.
   * inside an e2e spec's `beforeAll` (intermittent, differently-shaped
   * `TypeError`s from webpack's own internals, or an outright hang past the
   * hook timeout). See docs/decisions/0016-temporal-dunning-phase16-scope.md.
   * `bundle-in-subprocess.js` is deliberately plain JS (not `.ts`) so it
   * never needs a `ts-node`/`ts-jest` transpile hook to run — measured ~3x
   * slower in practice, since those hooks patch Node's module-loading
   * pipeline for every one of webpack's own `require()` calls.
   * `nest-cli.json`'s `compilerOptions.assets` copies it into `dist/`
   * verbatim on build, alongside the compiled `.js` from every `.ts` file.
   */
  private async bundleWorkflowCode(): Promise<string> {
    const scriptPath = require.resolve("./workflows/bundle-in-subprocess.js");
    const workflowsPath = require.resolve("./workflows/dunning.workflow");
    const dir = await mkdtemp(join(tmpdir(), "temporal-dunning-bundle-"));
    const outFile = join(dir, "workflow-bundle.js");
    try {
      await execFileAsync(process.execPath, [scriptPath, workflowsPath, outFile], { timeout: 120_000 });
      return await readFile(outFile, "utf8");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.worker?.shutdown();
    await this.connection?.close().catch(() => undefined);
  }
}
