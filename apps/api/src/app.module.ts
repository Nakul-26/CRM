import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { loadApiEnv } from "@sales-platform/config";
import { DatabaseModule } from "./database/database.module";
import { SharedModule } from "./shared/shared.module";
import { RequestContextMiddleware } from "./shared/context/request-context.middleware";
import { IdentityModule } from "./modules/identity/identity.module";
import { CrmModule } from "./modules/crm/crm.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadApiEnv()] }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: "." }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    SharedModule,
    IdentityModule,
    CrmModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
