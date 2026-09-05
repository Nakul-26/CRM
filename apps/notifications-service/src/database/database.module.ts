import { Global, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import type { NotificationsServiceEnv } from "@sales-platform/config";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Closes the underlying connection pool when the app shuts down — same
 * lifecycle idiom as apps/api/src/database/database.module.ts's
 * DatabaseLifecycle, ported verbatim.
 */
@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(private readonly client: Sql) {}

  async onModuleDestroy() {
    await this.client.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NotificationsServiceEnv, true>) =>
        postgres(config.get("DATABASE_URL", { infer: true }), { max: 10 }),
    },
    {
      provide: DATABASE_CONNECTION,
      inject: [DATABASE_CLIENT],
      useFactory: (client: Sql) => drizzle(client, { schema }),
    },
    {
      provide: DatabaseLifecycle,
      inject: [DATABASE_CLIENT],
      useFactory: (client: Sql) => new DatabaseLifecycle(client),
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
