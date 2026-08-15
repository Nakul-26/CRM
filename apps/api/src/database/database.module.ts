import { Global, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import type { ApiEnv } from "@sales-platform/config";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");
export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
export type Database = PostgresJsDatabase<typeof schema>;
/** The object handed to a `db.transaction(async (tx) => ...)` callback — same query API as Database. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Accepts either the top-level connection or an in-flight transaction — use for repository methods that must be transaction-composable. */
export type Db = Database | DbTransaction;

/**
 * Closes the underlying connection pool when the module (or the whole app,
 * e.g. in e2e tests via `app.close()`) shuts down. Without this, the
 * `postgres` client's open TCP connections keep the process/Jest worker
 * alive after tests finish.
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
      useFactory: (config: ConfigService<ApiEnv, true>) =>
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
