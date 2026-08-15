import type { Config } from "drizzle-kit";

export default {
  schema: "./src/database/schema/index.ts",
  out: "./src/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sales_platform:sales_platform@localhost:5434/sales_platform",
  },
} satisfies Config;
