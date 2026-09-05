import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationDigestService } from "./notification-digest.service";

/**
 * Thin timer wrapper, same shape as RenewalsScheduler — tests call
 * NotificationDigestService.sendDueDigests() directly instead of waiting on
 * the clock. See docs/decisions/0019-notification-preferences-phase19-scope.md.
 */
@Injectable()
export class NotificationDigestScheduler {
  constructor(private readonly digest: NotificationDigestService) {}

  @Cron("0 8 * * *")
  async handleCron(): Promise<void> {
    await this.digest.sendDueDigests();
  }
}
