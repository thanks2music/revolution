-- 0016: occurrences.starts_on を nullable にし、occurrence_view に「日程未定」を追加
--
-- ## なぜ
--
-- `mvp-definition.md` A-1-c (段階的発表への対応) は
--   「パターン 1 / 2 の記事は occurrences[] の日付が null になる。
--     A-4 の取り込みパイプラインは日付欠落を欠陥ではなく正常な状態として upsert できる必要がある」
-- と定めているのに、`0013` は starts_on を NOT NULL で作っていた。計画とスキーマの矛盾。
--
-- 必須のままだと LLM は日付が読めなくても何かを埋めるしかなく、実測 (2026-08-07 dry-run) で
-- `2025-01-01 〜 2025-12-31` という 1 年間まるごとの捏造が出ていた。
-- LTR 50 件の実地調査でも「7月下旬」「期間の記載なし」「常設店で終了日なし」が確認された。
--
-- BOSS 確定 (2026-08-09): **捏造させるより null で「不明」と表明させる**。
--
-- ## ⚠️ occurrence_view を必ず同時に直すこと
--
-- 旧 view は starts_on が NULL だと
--   `(now())::date < NULL` → NULL (偽ではない) → 次の分岐へ
--   `ends_on IS NULL` → 該当すれば 'ongoing'、しなければ `> NULL` も NULL → ELSE 'ongoing'
-- と流れ、**日程未発表の開催が「開催中」と表示される**。
-- A-1 が絶対条件とする「事実の正確性」の違反になるため、`starts_on IS NULL` の分岐を
-- cancelled の直後 (= 他のどの日付比較よりも前) に置く。
--
-- ## 適用対象
--
-- staging / production とも `0015` まで適用済み。本 migration は forward migration
-- (SoP §9.3 Option C-1)。`0013`〜`0015` は編集しない。

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

ALTER TABLE "public"."occurrences" ALTER COLUMN "starts_on" DROP NOT NULL;
--> statement-breakpoint

-- view は基底テーブルの列定義に依存するため、列変更後に作り直す。
-- `CREATE OR REPLACE VIEW` は列の型・順序が同一なら差し替え可能だが、
-- CASE の分岐追加で status の値域が変わるだけなので列構成は不変。
CREATE OR REPLACE VIEW "public"."occurrence_view"
WITH (security_invoker = on) AS
SELECT
  o.*,
  CASE
    WHEN o."cancelled_at" IS NOT NULL THEN 'cancelled'
    -- ★2026-08-09 追加: 日程未発表 (A-1-c パターン 1/2)。
    --   この分岐を日付比較より前に置かないと NULL が ELSE に落ちて 'ongoing' になる。
    WHEN o."starts_on" IS NULL THEN 'unscheduled'
    WHEN (now() AT TIME ZONE 'Asia/Tokyo')::date < o."starts_on" THEN 'scheduled'
    -- ★決定⑤: 終了日未定 / 常設。開始済みなら終わらない。
    WHEN o."ends_on" IS NULL THEN 'ongoing'
    WHEN (now() AT TIME ZONE 'Asia/Tokyo')::date > o."ends_on" THEN 'ended'
    ELSE 'ongoing'
  END AS "status"
FROM "public"."occurrences" o;
