import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import { DATABASE_CONNECTION, type Database } from "../../database/database.module";
import { Public } from "../../shared/decorators/public.decorator";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  @Public()
  @Get()
  async check() {
    let database: "up" | "down" = "down";
    try {
      await this.db.execute(sql`select 1`);
      database = "up";
    } catch {
      database = "down";
    }
    return { status: database === "up" ? "ok" : "degraded", database, timestamp: new Date().toISOString() };
  }
}
