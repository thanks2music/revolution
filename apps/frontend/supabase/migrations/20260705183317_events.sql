CREATE TABLE "event_categories" (
	"event_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	CONSTRAINT "event_categories_event_id_category_id_pk" PRIMARY KEY("event_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "event_titles" (
	"event_id" bigint NOT NULL,
	"title_id" bigint NOT NULL,
	CONSTRAINT "event_titles_event_id_title_id_pk" PRIMARY KEY("event_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"primary_category_id" bigint NOT NULL,
	"description" text,
	"official_url" text,
	"rating_sum" bigint DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_slug_format" CHECK ("events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "events_name_not_blank" CHECK (btrim("events"."name", E' 	
　') <> ''),
	CONSTRAINT "events_official_url_not_blank" CHECK ("events"."official_url" is null or btrim("events"."official_url", E' 	
　') <> '')
);
--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_titles" ADD CONSTRAINT "event_titles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_titles" ADD CONSTRAINT "event_titles_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_categories_category_idx" ON "event_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "event_titles_title_idx" ON "event_titles" USING btree ("title_id");
--> statement-breakpoint

-- ============================================================================
-- RLS 有効化 + SELECT 公開 policy (手動追記、drizzle-kit 自動生成範囲外)
-- ============================================================================
--
-- events / event_titles / event_categories は master データのため全ユーザーから
-- read 可能、書き込みは service role のみ (= INSERT/UPDATE/DELETE の policy を
-- 作らないことで実現)。
-- Supabase ベストプラクティス: https://supabase.com/docs/guides/database/postgres/row-level-security
-- 既存 profiles / favorites / categories / titles / venues の RLS と整合。

ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "events_select_all"
  ON "public"."events"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

ALTER TABLE "public"."event_titles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "event_titles_select_all"
  ON "public"."event_titles"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

ALTER TABLE "public"."event_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "event_categories_select_all"
  ON "public"."event_categories"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ============================================================================
-- GRANT (least-privilege、PR #258/#259 pattern 踏襲、categories/titles/venues と整合)
-- ============================================================================
-- Supabase managed project の `pg_default_acl` は初期化時に `arwdDxtm` (broad)
-- を anon/authenticated へ設定する仕様 (PR #258/#259 で発見)。新規テーブル作成時
-- にこの default_acl が cascade して anon/authenticated に TRIGGER/TRUNCATE/
-- REFERENCES が付与されるため、明示的に REVOKE ALL してから最小限の GRANT を
-- 与えることで least-privilege 状態を保証する。migration 0006 と同アプローチ。

-- events
REVOKE ALL ON "public"."events" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON "public"."events" TO anon, authenticated;
--> statement-breakpoint
GRANT ALL ON "public"."events" TO service_role;
--> statement-breakpoint

-- event_titles
REVOKE ALL ON "public"."event_titles" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON "public"."event_titles" TO anon, authenticated;
--> statement-breakpoint
GRANT ALL ON "public"."event_titles" TO service_role;
--> statement-breakpoint

-- event_categories
REVOKE ALL ON "public"."event_categories" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON "public"."event_categories" TO anon, authenticated;
--> statement-breakpoint
GRANT ALL ON "public"."event_categories" TO service_role;
