CREATE TABLE "categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

-- ============================================================================
-- 以下は手動追記 (drizzle-kit 自動生成範囲外): RLS 有効化 + SELECT 公開 policy
--                                              + 初期 seed (23 件)
-- ============================================================================
--
-- categories は master データのため全ユーザーから read 可能、書き込みは
-- service role のみ (= INSERT/UPDATE/DELETE の policy を作らないことで実現)。
-- Supabase ベストプラクティス: https://supabase.com/docs/guides/database/postgres/row-level-security
-- 既存 profiles/favorites RLS との整合: 同様に custom SQL で管理。

ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "categories_select_all"
  ON "public"."categories"
  FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

-- ============================================================================
-- 初期 seed (23 件、revolution-templates/ai-writer/config/event-type-slugs.yaml 由来)
-- ============================================================================
-- 各 slug の代表的な日本語名称を 1 つだけ seed する。同義語マッピング
-- (「カフェコラボ → collabo-cafe」等) は templates 側の責務 (SoC 遵守)。

INSERT INTO "public"."categories" ("slug", "name") VALUES
  ('collabo-cafe', 'コラボカフェ'),
  ('pop-up-store', 'ポップアップストア'),
  ('only-shop', 'オンリーショップ'),
  ('exhibition', '原画展'),
  ('exhibition-hall', '展覧会'),
  ('karaoke', 'カラオケコラボ'),
  ('escape-game', '脱出ゲーム'),
  ('mystery-solving', '謎解きイベント'),
  ('experience', '体験型イベント'),
  ('store-collabo', '小売コラボ'),
  ('game-collabo', 'ゲームコラボ'),
  ('apps-collabo', 'アプリコラボ'),
  ('online', 'オンラインイベント'),
  ('streaming', '配信イベント'),
  ('fashion', 'ファッションコラボ'),
  ('stay', '宿泊コラボ'),
  ('theme-park', 'テーマパーク・観光地'),
  ('hot-spring', '温泉コラボ'),
  ('travel', '旅行コラボ'),
  ('transportation', '交通コラボ'),
  ('campaign', 'キャンペーン'),
  ('stamp-rally', 'スタンプラリー'),
  ('other-collabo', 'その他コラボ');
