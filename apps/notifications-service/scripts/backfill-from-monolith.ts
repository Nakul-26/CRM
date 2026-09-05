/**
 * One-time, idempotent backfill: copies existing rows from the monolith's
 * `notifications.notifications` table (apps/api's database) into this
 * service's own `notifications` table. Not run automatically — a manual
 * operator step for the first time NOTIFICATIONS_SERVICE_ENABLED is turned
 * on, so historical notifications aren't silently stranded. See
 * docs/decisions/0018-microservices-split-phase18-scope.md.
 *
 * Usage:
 *   MONOLITH_DATABASE_URL=postgres://...:5434/sales_platform \
 *   DATABASE_URL=postgres://...:5434/sales_platform_notifications \
 *   tsx scripts/backfill-from-monolith.ts
 *
 * Safe to re-run: upserts by `id`, so partial/repeated runs don't duplicate
 * rows.
 */
import postgres from "postgres";

async function main() {
  const sourceUrl = process.env.MONOLITH_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("MONOLITH_DATABASE_URL is not set");
  if (!targetUrl) throw new Error("DATABASE_URL is not set");

  const source = postgres(sourceUrl, { max: 1 });
  const target = postgres(targetUrl, { max: 1 });

  try {
    const rows = await source`
      SELECT id, organization_id, user_id, type, title, body, link, is_read, read_at, created_at
      FROM notifications.notifications
      ORDER BY created_at ASC
    `;

    console.log(`Found ${rows.length} notification row(s) in the monolith database.`);

    let copied = 0;
    for (const row of rows) {
      await target`
        INSERT INTO notifications (id, organization_id, user_id, type, title, body, link, is_read, read_at, created_at)
        VALUES (${row.id}, ${row.organization_id}, ${row.user_id}, ${row.type}, ${row.title}, ${row.body}, ${row.link}, ${row.is_read}, ${row.read_at}, ${row.created_at})
        ON CONFLICT (id) DO NOTHING
      `;
      copied++;
    }

    console.log(`Backfill complete: ${copied} row(s) processed.`);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
