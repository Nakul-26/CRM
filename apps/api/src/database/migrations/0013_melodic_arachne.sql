ALTER TABLE "support"."ticket_comments" ADD COLUMN "source" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "support"."ticket_comments" ADD COLUMN "external_message_id" text;--> statement-breakpoint
-- Added nullable + backfilled + set NOT NULL, rather than a single NOT NULL
-- ADD COLUMN, so this migration doesn't fail against a database that
-- already has ticket rows (gen_random_uuid() has been a built-in Postgres
-- function since v13, no extension needed).
ALTER TABLE "support"."tickets" ADD COLUMN "reply_token" uuid;--> statement-breakpoint
UPDATE "support"."tickets" SET "reply_token" = gen_random_uuid() WHERE "reply_token" IS NULL;--> statement-breakpoint
ALTER TABLE "support"."tickets" ALTER COLUMN "reply_token" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_comments_external_message_id_unique" ON "support"."ticket_comments" USING btree ("external_message_id") WHERE "ticket_comments"."external_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_reply_token_unique" ON "support"."tickets" USING btree ("reply_token");