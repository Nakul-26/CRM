CREATE SCHEMA "support";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support"."kb_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"category" text,
	"body" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kb_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support"."sla_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"first_response_target_minutes" integer NOT NULL,
	"resolution_target_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support"."ticket_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support"."tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_id" uuid,
	"assignee_id" uuid,
	"sla_policy_id" uuid,
	"first_response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."kb_articles" ADD CONSTRAINT "kb_articles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."sla_policies" ADD CONSTRAINT "sla_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."ticket_comments" ADD CONSTRAINT "ticket_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "support"."tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."tickets" ADD CONSTRAINT "tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."tickets" ADD CONSTRAINT "tickets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "crm"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support"."tickets" ADD CONSTRAINT "tickets_sla_policy_id_sla_policies_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "support"."sla_policies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_org_idx" ON "support"."kb_articles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_slug_idx" ON "support"."kb_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_policies_org_idx" ON "support"."sla_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sla_policies_org_priority_unique" ON "support"."sla_policies" USING btree ("organization_id","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_comments_ticket_idx" ON "support"."ticket_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_org_idx" ON "support"."tickets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_org_status_idx" ON "support"."tickets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_account_idx" ON "support"."tickets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_assignee_idx" ON "support"."tickets" USING btree ("assignee_id");