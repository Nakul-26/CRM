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
import { PaymentsModule } from "./modules/payments/payments.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { HealthModule } from "./modules/health/health.module";

// Loaded eagerly (not deferred inside ConfigModule.forRoot's `load` closure)
// because the imports array below needs to branch on it at module-decoration
// time — NestJS `@Module({ imports })` arrays are plain arrays evaluated
// once, not lazily re-evaluated per request. See
// docs/decisions/0018-microservices-split-phase18-scope.md.
const env = loadApiEnv();

if (env.NOTIFICATIONS_SERVICE_ENABLED && env.EVENT_BUS_TRANSPORT !== "rabbitmq") {
  // The extracted notifications service only ever receives events via the
  // domain.events RabbitMQ exchange (see
  // apps/notifications-service/src/rabbitmq/domain-events-consumer.ts) —
  // that exchange is only populated when EVENT_BUS_TRANSPORT=rabbitmq
  // (RabbitMQAuditTransport publishes every event onto it under that
  // setting, regardless of audit relevance). Failing fast here beats the
  // alternative: notifications silently never arriving, with no error
  // anywhere.
  throw new Error(
    "NOTIFICATIONS_SERVICE_ENABLED=true requires EVENT_BUS_TRANSPORT=rabbitmq " +
      "(the extracted notifications service consumes domain events from the " +
      "domain.events RabbitMQ exchange, which is only populated under that transport).",
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => env] }),
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
    PaymentsModule,
    AnalyticsModule,
    // Dropped entirely — not disabled, gone — once the extracted
    // apps/notifications-service owns this domain (Phase 18). Leaving it
    // mounted in both places would silently create two independent,
    // diverging notification stores.
    ...(env.NOTIFICATIONS_SERVICE_ENABLED ? [] : [NotificationsModule]),
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
