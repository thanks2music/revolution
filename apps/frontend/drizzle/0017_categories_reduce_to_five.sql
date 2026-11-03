-- 0017: categories を 23 件 → 5 件に絞る (企画の URL の第 1 階層になるため)
--
-- ## なぜ
--
-- 企画と開催の URL を `/events/{id}` から `/{categories.slug}/{id}` へ移す
-- (例: `/collabo-cafe/11`、2026-11-03 BOSS 確定)。slug がそのまま URL のセグメントになるので、
-- 実際に件数のある種別に絞る。残すのは 5 つ:
--
--   collabo-cafe / pop-up-store / exhibition / chain-store / other
--
-- 選定の根拠と主分類の決め方 (分類ルール) の正本は
-- `one-more-time/docs/event-review-data-model.md` §6。
--
-- ## 何をするか
--
-- 1. 改名 (id は変えない): `store-collabo` → `chain-store` / `other-collabo` → `other`
-- 2. 表示名: exhibition = 原画展・展示会 / chain-store = チェーン店コラボ / other = その他のイベント
-- 3. 残り 18 行を削除
--
-- 日本語の表記ゆれ (「展覧会」「オンリーショップ」など) は templates の
-- `event-type-slugs.yaml` / `slug-registry.yaml` が 5 つへ寄せる。DB には入れない
-- (`categories.name` は代表名 1 つだけ、`shared/schemas/db/categories.ts`)。
--
-- ## 安全性
--
-- - データだけの変更で、列も制約も変えない。URL に種別を使わない旧コードとも、使う新コードとも
--   互換 (supabase-migration-workflow.md §5.2 の forward-only)
-- - 削除する行を参照する events / event_categories があれば、先に RAISE EXCEPTION で止める
--   (2026-11-03 時点で参照されているのは collabo-cafe だけ)。FK も events = NO ACTION /
--   event_categories = RESTRICT なので、ガードを抜けても削除自体が失敗する
-- - 改名は id を保つので、events.primary_category_id の参照は壊れない
-- - 再実行しても no-op (改名は旧 slug、削除は slug の一覧で絞るため)
--
-- ## 適用対象
--
-- staging / production とも `0016` まで適用済み。本 migration は forward migration
-- (SoP §9.3 Option C-1)。`0002` の seed は編集しない。

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

DO $$
DECLARE
  in_use text;
BEGIN
  SELECT string_agg(DISTINCT c."slug", ', ' ORDER BY c."slug") INTO in_use
  FROM "public"."categories" c
  WHERE c."slug" IN (
      'only-shop', 'exhibition-hall', 'karaoke', 'escape-game', 'mystery-solving',
      'experience', 'game-collabo', 'apps-collabo', 'online', 'streaming', 'fashion',
      'stay', 'theme-park', 'hot-spring', 'travel', 'transportation', 'campaign',
      'stamp-rally'
    )
    AND (
      EXISTS (SELECT 1 FROM "public"."events" e WHERE e."primary_category_id" = c."id")
      OR EXISTS (SELECT 1 FROM "public"."event_categories" ec WHERE ec."category_id" = c."id")
    );

  IF in_use IS NOT NULL THEN
    RAISE EXCEPTION
      'categories to be removed are still referenced by events / event_categories: %. '
      'Reassign those events to one of the five types first.', in_use;
  END IF;
END $$;
--> statement-breakpoint

UPDATE "public"."categories" SET "slug" = 'chain-store', "name" = 'チェーン店コラボ'
WHERE "slug" = 'store-collabo';
--> statement-breakpoint

UPDATE "public"."categories" SET "slug" = 'other', "name" = 'その他のイベント'
WHERE "slug" = 'other-collabo';
--> statement-breakpoint

UPDATE "public"."categories" SET "name" = '原画展・展示会'
WHERE "slug" = 'exhibition';
--> statement-breakpoint

DELETE FROM "public"."categories"
WHERE "slug" IN (
  'only-shop', 'exhibition-hall', 'karaoke', 'escape-game', 'mystery-solving',
  'experience', 'game-collabo', 'apps-collabo', 'online', 'streaming', 'fashion',
  'stay', 'theme-park', 'hot-spring', 'travel', 'transportation', 'campaign',
  'stamp-rally'
);
