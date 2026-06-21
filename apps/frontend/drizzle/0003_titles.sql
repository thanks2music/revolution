CREATE TABLE "titles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_kana" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "titles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "titles_slug_format" CHECK ("titles"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "titles_kind_allowed" CHECK ("titles"."kind" in ('anime','manga','game','novel','other'))
);
--> statement-breakpoint

-- ============================================================================
-- 以下は手動追記 (drizzle-kit 自動生成範囲外): RLS 有効化 + SELECT 公開 policy
--                                              + 初期 seed (8 件、代表サンプル)
-- ============================================================================
--
-- titles は master データのため全ユーザーから read 可能、書き込みは
-- service role のみ (= INSERT/UPDATE/DELETE の policy を作らないことで実現)。
-- Supabase ベストプラクティス: https://supabase.com/docs/guides/database/postgres/row-level-security
-- 既存 profiles/favorites/categories RLS との整合: 同様に custom SQL で管理。

ALTER TABLE "public"."titles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "titles_select_all"
  ON "public"."titles"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ============================================================================
-- 初期 seed (8 件、代表サンプル、handoff §3.C 採用)
-- ============================================================================
-- ローカル動作確認時の SELECT 結果が空だと検証が不便なため、代表的な
-- 作品 8 件を投入する (manga / game / other の複数 kind をカバーし、
-- Layer 1 全数テストの回帰検知に使う)。本格的な作品マスタは AI Writer
-- が逐次追加する設計。
-- `ON CONFLICT (slug) DO NOTHING` で冪等性を確保 (psql 直打ち / 手動リセット時の
-- 再実行耐性。既存 RLS migration の `CREATE OR REPLACE` / `DROP ... IF EXISTS`
-- パターンと整合)。

INSERT INTO "public"."titles" ("slug", "name", "name_kana", "kind") VALUES
  ('jujutsu-kaisen', '呪術廻戦', 'じゅじゅつかいせん', 'manga'),
  ('spy-family', 'SPY×FAMILY', 'すぱいふぁみりー', 'manga'),
  ('frieren', '葬送のフリーレン', 'そうそうのふりーれん', 'manga'),
  ('tougen-anki', '桃源暗鬼', 'とうげんあんき', 'manga'),
  ('chiikawa', 'ちいかわ', 'ちいかわ', 'manga'),
  ('pokemon', 'ポケットモンスター', 'ぽけっともんすたー', 'game'),
  ('genshin-impact', '原神', 'げんしん', 'game'),
  ('sanrio-characters', 'サンリオキャラクターズ', 'さんりおきゃらくたーず', 'other')
ON CONFLICT ("slug") DO NOTHING;
