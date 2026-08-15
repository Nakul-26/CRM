CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"company_size" text,
	"website" text,
	"email" text,
	"phone" text,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_id" uuid,
	"search_vector" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("industry", '') || ' ' || coalesce("website", '')), 'B')
	) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm"."activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid,
	"contact_id" uuid,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_title" text,
	"department" text,
	"owner_id" uuid,
	"social_profiles" jsonb,
	"communication_preferences" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_vector" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("first_name", '') || ' ' || coalesce("last_name", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("email", '') || ' ' || coalesce("job_title", '')), 'B')
	) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."accounts" ADD CONSTRAINT "accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "crm"."contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_org_idx" ON "crm"."accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_org_name_idx" ON "crm"."accounts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_owner_idx" ON "crm"."accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_idx" ON "crm"."activities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_account_idx" ON "crm"."activities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_contact_idx" ON "crm"."activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_account_created_idx" ON "crm"."activities" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_org_idx" ON "crm"."contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_account_idx" ON "crm"."contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_search_idx" ON "crm"."accounts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_search_idx" ON "crm"."contacts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_type_created_idx" ON "identity"."audit_log" USING btree ("organization_id","event_type","created_at");