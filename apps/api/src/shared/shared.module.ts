import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { RequestContextService } from "./context/request-context";
import { DomainEventBus } from "./events/domain-event-bus";
import { AuditListener } from "./audit/audit.listener";
import { RabbitMQAuditTransport } from "./audit/rabbitmq-audit-transport";
import { MailerService } from "./mail/mailer.service";
import { MailListener } from "./mail/mail.listener";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { GlobalExceptionFilter } from "./filters/http-exception.filter";

@Global()
@Module({
  imports: [JwtModule.register({ global: true })],
  providers: [
    RequestContextService,
    DomainEventBus,
    AuditListener,
    RabbitMQAuditTransport,
    MailerService,
    MailListener,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  // MailerService is exported starting Phase 19: NotificationsService is the
  // first consumer outside this module (immediate/digest delivery of
  // notification emails) — see
  // docs/decisions/0019-notification-preferences-phase19-scope.md. Every
  // prior email path (MailListener) lived inside this module, so exporting
  // it was never needed before.
  exports: [RequestContextService, DomainEventBus, MailerService],
})
export class SharedModule {}
