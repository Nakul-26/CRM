import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

/**
 * Unlike apps/api's migrate.ts, this one first has to ensure its own
 * database exists — apps/api's `sales_platform` database is created by
 * docker-compose's POSTGRES_DB on first init, but this service's
 * `sales_platform_notifications` database is not. Same
 * check-then-CREATE-DATABASE idiom apps/api/test/setup/test-app.ts already
 * uses for its test database. Connects to the `postgres` maintenance
 * database on the same server/credentials to run the check, since you can't
 * run CREATE DATABASE against the database you're trying to create.
 */
async function ensureDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error(`DATABASE_URL has no database name: ${connectionString}`);

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }
}

export async function runMigrations(connectionString: string): Promise<void> {
  await ensureDatabase(connectionString);

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  await client.end();
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv/config");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  console.log("Running migrations...");
  runMigrations(connectionString)
    .then(() => console.log("Migrations complete."))
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
