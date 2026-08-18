CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "leads"."leads" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
	setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
	setweight(to_tsvector('english', coalesce("company", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_search_idx" ON "leads"."leads" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_name_trgm_idx" ON "crm"."accounts" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_name_trgm_idx" ON "crm"."contacts" USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_name_trgm_idx" ON "leads"."leads" USING gin ("name" gin_trgm_ops);
