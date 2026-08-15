import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION, type Database, type Db } from "../../../database/database.module";
import { organizations } from "../../../database/schema";

@Injectable()
export class OrganizationsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(name: string, tx: Db = this.db) {
    // Check and insert must run against the same connection/transaction —
    // otherwise the uniqueness read sees a snapshot from before the
    // transaction started, widening the race window between two concurrent
    // registrations for the same organization name.
    const slug = await this.uniqueSlug(name, tx);
    const [org] = await tx.insert(organizations).values({ name, slug }).returning();
    return org;
  }

  async findById(id: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return org;
  }

  async findBySlug(slug: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return org;
  }

  private async uniqueSlug(name: string, tx: Db): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "organization";

    let candidate = base;
    let suffix = 1;
    // Small orgs table — a linear probe is fine; revisit if this ever becomes a hot path.
    while (await this.slugTaken(candidate, tx)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private async slugTaken(slug: string, tx: Db): Promise<boolean> {
    const [existing] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return Boolean(existing);
  }
}
