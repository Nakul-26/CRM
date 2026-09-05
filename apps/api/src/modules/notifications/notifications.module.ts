import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsListener } from "./notifications.listener";
import { NotificationDigestService } from "./notification-digest.service";
import { NotificationDigestScheduler } from "./notification-digest.scheduler";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener, NotificationDigestService, NotificationDigestScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
