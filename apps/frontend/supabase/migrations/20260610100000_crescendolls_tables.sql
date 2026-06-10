CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"target_type" text DEFAULT 'article' NOT NULL,
	"target_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_target_type_target_key_pk" PRIMARY KEY("user_id","target_type","target_key"),
	CONSTRAINT "favorites_target_type_allowed" CHECK ("favorites"."target_type" in ('article'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text,
	"display_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_username_format" CHECK ("profiles"."username" ~ '^[a-zA-Z0-9_]{3,24}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_idx" ON "profiles" USING btree (lower("username"));