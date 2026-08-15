import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

export async function runMigrations(connectionString: string): Promise<void> {
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
