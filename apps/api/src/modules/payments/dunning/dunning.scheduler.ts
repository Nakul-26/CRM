import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { and, eq, lte } from "drizzle-orm";
import type { ApiEnv } from "@sales-platform/config";
import { DATABASE_CONNECTION, type Database } from "../../../database/database.module";
import { dunningCycles, payments } from "../../../database/schema";
import { DunningActionsService } from "./dunning-actions.service";

/**
 * Polls due dunning_cycles rows and fires the next retry attempt — only
 * meaningful for the in-process (Postgres) DunningOrchestrator backend;
 * under WORKFLOW_ENGINE=temporal, retries are driven by the workflow's own
 * sleep timers instead, so this scheduler simply finds nothing to do (no
 * "waiting" rows are ever created by the Temporal orchestrator). See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md.
 */
@Injectable()
export class DunningScheduler {
  private readonly logger = new Logger(DunningScheduler.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly actions: DunningActionsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  @Cron("*/15 * * * *")
  async handleCron(): Promise<void> {
    if (this.config.get("WORKFLOW_ENGINE", { infer: true }) !== "in-process") return;
    await this.processDueCycles();
  }

  async processDueCycles(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({
        cycleId: dunningCycles.id,
        organizationId: dunningCycles.organizationId,
        subscriptionId: dunningCycles.subscriptionId,
        latestPaymentId: dunningCycles.latestPaymentId,
      })
      .from(dunningCycles)
      .where(and(eq(dunningCycles.status, "waiting"), lte(dunningCycles.nextAttemptAt, now)));

    for (const cycle of due) {
      await this.fireAttempt(cycle);
    }
    return due.length;
  }

  private async fireAttempt(cycle: {
    cycleId: string;
    organizationId: string;
    subscriptionId: string;
    latestPaymentId: string | null;
  }): Promise<void> {
    try {
      const actorId = await this.resolveActorId(cycle.organizationId, cycle.latestPaymentId);
      if (!actorId) return;

      await this.db.update(dunningCycles).set({ status: "attempting", updatedAt: new Date() }).where(eq(dunningCycles.id, cycle.cycleId));
      await this.actions.attemptCharge(cycle.organizationId, actorId, cycle.subscriptionId);
    } catch (error) {
      this.logger.error(`Failed to fire dunning attempt for subscription ${cycle.subscriptionId}`, error as Error);
    }
  }

  /** Same responsible party as the payment that most recently triggered this cycle. */
  private async resolveActorId(organizationId: string, latestPaymentId: string | null): Promise<string | null> {
    if (!latestPaymentId) return null;
    const [payment] = await this.db
      .select({ createdBy: payments.createdBy })
      .from(payments)
      .where(and(eq(payments.organizationId, organizationId), eq(payments.id, latestPaymentId)))
      .limit(1);
    return payment?.createdBy ?? null;
  }
}
