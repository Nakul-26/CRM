CREATE TABLE IF NOT EXISTS "payments"."dunning_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"latest_payment_id" uuid,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments"."dunning_cycles" ADD CONSTRAINT "dunning_cycles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments"."dunning_cycles" ADD CONSTRAINT "dunning_cycles_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments"."dunning_cycles" ADD CONSTRAINT "dunning_cycles_latest_payment_id_payments_id_fk" FOREIGN KEY ("latest_payment_id") REFERENCES "payments"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dunning_cycles_org_idx" ON "payments"."dunning_cycles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dunning_cycles_pending_idx" ON "payments"."dunning_cycles" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dunning_cycles_active_subscription_unique" ON "payments"."dunning_cycles" USING btree ("subscription_id") WHERE "dunning_cycles"."status" in ('waiting', 'attempting');