import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import type { NotificationsServiceEnv } from "@sales-platform/config";
import { AppModule } from "./app.module";

/**
 * Phase 18's extracted notifications service — a separately-deployable
 * NestJS app, own database, own RabbitMQ consumer. See
 * docs/decisions/0018-microservices-split-phase18-scope.md. Bootstrap
 * mirrors apps/api/src/main.ts as closely as this smaller app needs to
 * (helmet, CORS, global prefix `api/v1` so its routes line up with what
 * apps/web's gateway forwards) — no Swagger/rawBody, neither of which this
 * service needs.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<NotificationsServiceEnv, true>);

  app.use(helmet());
  app.enableCors({
    origin: config.get("CORS_ORIGIN", { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`Notifications service listening on http://localhost:${port}/api/v1`);
}

bootstrap();
