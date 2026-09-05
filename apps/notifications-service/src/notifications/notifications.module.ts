import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DomainEventsConsumer } from "../rabbitmq/domain-events-consumer";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsConsumerService } from "./notifications-consumer.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsConsumerService, DomainEventsConsumer],
})
export class NotificationsModule {}
