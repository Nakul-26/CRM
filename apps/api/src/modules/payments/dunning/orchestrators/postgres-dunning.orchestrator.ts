import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { DATABASE_CONNECTION, type Database } from "../../../../database/database.module";
import { dunningCycles } from "../../../../database/schema";
import { DunningActionsService } from "../dunning-actions.service";
import { getDunningRetryDelaysMs, MAX_DUNNING_ATTEMPTS } from "../dunning-policy";
import type { DunningAttemptOutcomeInput, DunningCycleInput, DunningOrchestrator } from "./dunning-orchestrator.interface";

const ACTIVE_STATUSES = ["waiting", "attempting"] as const;

/**
 * Waiting/retrying is driven by a Postgres job table polled by
 * DunningScheduler on a timer — the same cron+table shape ADR 0007 already
 * validated for renewal reminders, applied here to dunning. See
 * docs/decisions/0016-temporal-dunning-phase16-scope.md. Default backend
 * (WORKFLOW_ENGINE=in-process); needs no external infrastructure.
 */
@Injectable()
export class PostgresDunningOrchestrator implements DunningOrchestrator {
  readonly kind = "in-process" as const;
  private readonly logger = new Logger(PostgresDunningOrchestrator.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly actions: DunningActionsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  async hasActiveCycle(subscriptionId: string): Promise<boolean> {
    const [cycle] = await this.db
      .select({ id: dunningCycles.id })
      .from(dunningCycles)
      .where(and(eq(dunningCycles.subscriptionId, subscriptionId), inArray(dunningCycles.status, [...ACTIVE_STATUSES])))
      .limit(1);
    return Boolean(cycle);
  }

  async startDunning(input: DunningCycleInput): Promise<void> {
    const delays = this.getDelays();
    try {
      await this.db.insert(dunningCycles).values({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        latestPaymentId: input.paymentId,
        attemptNumber: 1,
        nextAttemptAt: new Date(Date.now() + delays[0]),
        status: "waiting",
      });
    } catch (error) {
      // Active-cycle unique index conflict — a dunning cycle is already in
      // flight for this subscription (e.g. a duplicate payment.failed).
      this.logger.warn(`Dunning cycle already active for subscription ${input.subscriptionId}, ignoring duplicate start`, error as Error);
    }
  }

  async recordAttemptOutcome(input: DunningAttemptOutcomeInput): Promise<void> {
    const [cycle] = await this.db
      .select()
      .from(dunningCycles)
      .where(and(eq(dunningCycles.subscriptionId, input.subscriptionId), inArray(dunningCycles.status, [...ACTIVE_STATUSES])))
      .limit(1);
    if (!cycle) {
      this.logger.warn(`No active dunning cycle found for subscription ${input.subscriptionId} — ignoring attempt outcome`);
      return;
    }

    if (input.succeeded) {
      await this.db
        .update(dunningCycles)
        .set({ status: "succeeded", latestPaymentId: input.paymentId, updatedAt: new Date() })
        .where(eq(dunningCycles.id, cycle.id));
      return;
    }

    if (cycle.attemptNumber >= MAX_DUNNING_ATTEMPTS) {
      await this.db
        .update(dunningCycles)
        .set({ status: "exhausted", latestPaymentId: input.paymentId, updatedAt: new Date() })
        .where(eq(dunningCycles.id, cycle.id));
      await this.actions.cancelSubscription(input.organizationId, input.actorId, input.subscriptionId);
      return;
    }

    const delays = this.getDelays();
    const nextAttemptNumber = cycle.attemptNumber + 1;
    await this.db
      .update(dunningCycles)
      .set({
        attemptNumber: nextAttemptNumber,
        nextAttemptAt: new Date(Date.now() + delays[nextAttemptNumber - 1]),
        status: "waiting",
        latestPaymentId: input.paymentId,
        updatedAt: new Date(),
      })
      .where(eq(dunningCycles.id, cycle.id));
  }

  private getDelays(): number[] {
    return getDunningRetryDelaysMs(this.config.get("DUNNING_RETRY_DELAYS_MS", { infer: true }));
  }
}
