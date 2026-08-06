-- ============================================================================
-- Migration 0015: review_images の UPDATE を sort_order 列のみに絞る
-- ============================================================================
-- **0013 の forward fix** (claude[bot] PR #287 レビュー指摘、Medium)。
-- SoP §9.3 Option C-1 に従い、適用済みの 0013 / 0014 は編集せず新規 migration へ。
--
-- 【何が問題だったか】
--   0013 は `reviews` に対しては列単位 GRANT を張っていた:
--     GRANT UPDATE (rating, body, visited_on, deleted_at) ... TO authenticated
--   目的は `helpful_count` の自己申告 (= 自分のレビューの「参考になった」数を
--   直接書き換える) を権限段階で止めること。
--
--   ところが `review_images` はテーブル単位のままだった:
--     GRANT SELECT, INSERT, UPDATE, DELETE ON review_images TO authenticated
--
--   `review_images_update_own` policy のコメント自身が「UPDATE は sort_order の
--   並べ替えのために必要」と書いており、**意図は最初から sort_order だけ**
--   だったが、GRANT がそれに追いついていなかった。
--
-- 【実際に何ができてしまうか (ローカルで実測)】
--   ログイン中のユーザーが、自分の (未削除の) レビューに紐づく画像行の
--   `object_key` を **任意の R2 キーへ書き換えられる**:
--
--     set local role authenticated;
--     update public.review_images set object_key = 'reviews/someone-else/private.webp';
--     → 成功してしまう
--
--   `object_key` は R2 オブジェクトへのポインタで、配信 URL は読み取り時に
--   組み立てられる。したがって **他人の写真を自分のギャラリーに表示させられる**。
--   RLS は「自分の未削除レビューに属する行か」しか見ないため policy では防げず、
--   `reviews.helpful_count` と同じく **列単位 GRANT で権限段階から落とす**のが正解。
--
--   ※ 本 GRANT を使う API / UI はまだ実装されていないため現時点の実害はない。
--     ただし 0013 は並べ替え機能の土台になるため、実装時に見落とされやすい。
--
-- 【なぜ他の列も落ちるか (副次的な締まり)】
--   絞り込みによって `review_id` / `id` / `created_at` も UPDATE 対象から外れる。
--     - `review_id`: trg_review_images_freeze_review (0013) が既に禁止しているが、
--       あちらは service_role にも効かせるための多層防御。ここは authenticated 向け。
--     - `id` / `created_at`: 代理キーと孤児画像回収の基準時刻で、書き換える用途がない。
--   結果として `reviews` 側と同じ「意図した列だけを開ける」形に揃う。
--
-- 【互換性】
--   REVOKE / GRANT は schema 構造を変えないため forward-only ルール上安全
--   (§5.2)。SELECT / INSERT / DELETE は据え置きで、並べ替え (sort_order) と
--   画像の追加・削除という正当な用途は従来どおり通る。
-- ============================================================================

-- 既存テーブル (review_images) に対する GRANT 変更のため、0013 Part A と同じ
-- ガードを踏襲する。**0014 では付け忘れていた** (claude[bot] nit 指摘)。0014 は
-- staging 適用済みで遡って直せないため、以降の forward migration で揃える。
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

-- テーブル単位の UPDATE を落とす (SELECT / INSERT / DELETE は残す)。
REVOKE UPDATE ON TABLE "public"."review_images" FROM authenticated;
--> statement-breakpoint

-- 並べ替えに必要な sort_order だけを開ける。
GRANT UPDATE ("sort_order") ON TABLE "public"."review_images" TO authenticated;
