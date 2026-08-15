import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { RequestContextService } from "./context/request-context";
import { DomainEventBus } from "./events/domain-event-bus";
import { AuditListener } from "./audit/audit.listener";
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [RequestContextService, DomainEventBus],
})
export class SharedModule {}
