import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { ApiEnv } from "@sales-platform/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true so the Stripe webhook route can verify the signature
  // against the exact request bytes (req.rawBody) while every other route
  // still gets the normal parsed JSON body.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService<ApiEnv, true>);

  app.use(helmet());
  app.enableCors({
    origin: config.get("CORS_ORIGIN", { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Sales Platform API")
    .setDescription("Phase 1: Identity & Access — organizations, users, teams, roles, auth")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = config.get("PORT", { infer: true });
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
