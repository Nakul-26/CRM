import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { loadApiEnv } from "@sales-platform/config";
import { DatabaseModule } from "./database/database.module";
import { SharedModule } from "./shared/shared.module";
import { RequestContextMiddleware } from "./shared/context/request-context.middleware";
import { IdentityModule } from "./modules/identity/identity.module";
import { CrmModule } from "./modules/crm/crm.module";
import { SalesModule } from "./modules/sales/sales.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { ProductsModule } from "./modules/products/products.module";
import { QuotesModule } from "./modules/quotes/quotes.module";
import { SupportModule } from "./modules/support/support.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadApiEnv()] }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: "." }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    SharedModule,
    IdentityModule,
    CrmModule,
    SalesModule,
    LeadsModule,
    ProductsModule,
    QuotesModule,
    SupportModule,
    SubscriptionsModule,
    AnalyticsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
