import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadNotificationsServiceEnv } from "@sales-platform/config";
import { DatabaseModule } from "./database/database.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => loadNotificationsServiceEnv()] }), DatabaseModule, NotificationsModule],
})
export class AppModule {}
