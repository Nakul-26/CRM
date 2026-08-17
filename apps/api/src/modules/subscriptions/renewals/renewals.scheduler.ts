import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { RenewalsService } from "./renewals.service";

/**
 * First scheduled/background process in the codebase — see
 * docs/decisions/0007-subscriptions-phase7-scope.md. Kept to a one-line
 * timer wrapper so tests call RenewalsService.processDueReminders()
 * directly instead of waiting on the clock.
 */
@Injectable()
export class RenewalsScheduler {
  constructor(private readonly renewals: RenewalsService) {}

  @Cron("*/15 * * * *")
  async handleCron(): Promise<void> {
    await this.renewals.processDueReminders();
  }
}
