CREATE TABLE "occurrences" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "occurrences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"venue_id" bigint,
	"venue_label" text,
	"slug" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"cancelled_at" timestamp with time zone,
	"verified" boolean DEFAULT false NOT NULL,
	"rating_sum" bigint DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrences_slug_format" CHECK ("occurrences"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "occurrences_venue_label_not_blank" CHECK ("occurrences"."venue_label" is null or btrim("occurrences"."venue_label", E' 	
　') <> ''),
	CONSTRAINT "occurrences_dates_chk" CHECK ("occurrences"."ends_on" is null or "occurrences"."ends_on" >= "occurrences"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "review_helpful" (
	"review_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_helpful_review_id_user_id_pk" PRIMARY KEY("review_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_images" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"review_id" bigint NOT NULL,
	"object_key" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_images_object_key_not_blank" CHECK (btrim("review_images"."object_key", E' 	
　') <> ''),
	CONSTRAINT "review_images_sort_order_chk" CHECK ("review_images"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurrence_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text,
	"visited_on" date,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_chk" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body_not_blank" CHECK ("reviews"."body" is null or btrim("reviews"."body", E' 	
　') <> '')
);
--> statement-breakpoint
CREATE TABLE "title_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"title_id" bigint NOT NULL,
	CONSTRAINT "title_aliases_alias_not_blank" CHECK (btrim("title_aliases"."alias", E' 	
　') <> '')
);
--> statement-breakpoint
CREATE TABLE "venue_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"venue_id" bigint NOT NULL,
	CONSTRAINT "venue_aliases_alias_not_blank" CHECK (btrim("venue_aliases"."alias", E' 	
　') <> '')
);
--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful" ADD CONSTRAINT "review_helpful_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful" ADD CONSTRAINT "review_helpful_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_aliases" ADD CONSTRAINT "title_aliases_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_aliases" ADD CONSTRAINT "venue_aliases_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occurrences_venue_idx" ON "occurrences" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "occurrences_dates_idx" ON "occurrences" USING btree ("starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_event_slug_uniq" ON "occurrences" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "review_helpful_user_idx" ON "review_helpful" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_images_review_idx" ON "review_images" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_occurrence_user_uniq" ON "reviews" USING btree ("occurrence_id","user_id");--> statement-breakpoint
CREATE INDEX "reviews_user_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "title_aliases_title_idx" ON "title_aliases" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "venue_aliases_venue_idx" ON "venue_aliases" USING btree ("venue_id");--> statement-breakpoint

-- ============================================================================
-- 以降は drizzle-kit 自動生成範囲外の手動追記 (0009_events.sql と同じ作法)
--   Part A: ロック / タイムアウトのガード
--   Part B: private schema のトリガ関数 5 本
--   Part C: トリガ 5 本
--   Part D: occurrence_view (状態導出、JST 固定)
--   Part E: RLS + GRANT (新規 6 テーブル + view)
--
-- 設計の一次資料: one-more-time/docs/schema/revolution-functions.sql
--   (S0「設計確定」2026-08-02 確定版)。本 migration は同ファイルの
--   L36 以降 (view / トリガ / RLS / GRANT) を適用したもの。
--   ⚠️ 同ファイル L21 の `create extension postgis` と L27-29 の
--      `profiles_auth_user_fkey` は **0007 / 0011 で適用済み**のため
--      本 migration では実行しない (再実行すると 0007 の extensions schema
--      配置を壊す)。
--
-- 【S0 確定版から意図的に変更した 4 点 (BOSS 承認 2026-08-06)】
--   1. トリガ関数を `public` ではなく **`private` schema + `SET search_path = ''`**
--      に置き、集計を書き込む 2 本を **SECURITY DEFINER** にした。
--      理由は Part B のコメントに詳述。
--   2. `occurrence_view` に **`security_invoker = on`** を付けた。
--      理由は Part D のコメントに詳述。
--   3. `occurrences` に slug format + venue_label not_blank の CHECK を足した
--      (既存 4 master テーブルの規約に揃える)。
--   4. **冗長な index 2 本を落とした** ―
--      `reviews_occurrence_idx (occurrence_id)` と
--      `occurrences_event_idx (event_id)` は、それぞれ
--      `reviews_occurrence_user_uniq (occurrence_id, user_id)` /
--      `occurrences_event_slug_uniq (event_id, slug)` の **leftmost prefix**
--      と完全に重複していた。落とした状態で `EXPLAIN` し、SELECT も
--      ON DELETE CASCADE も UNIQUE 複合側で引けることを実測確認済み。
--      設計自身の論拠 (`review_helpful_user_idx` は複合 PK の 2 列目で
--      leftmost prefix に該当しない **から** 必要) と整合させた形。
--      詳細は `shared/schemas/db/{reviews,occurrences}.ts` のコメント。
--      → 一次資料 `revolution-schema.ts` にも追随させること。
--
-- 【`/supabase-postgres-best-practices` 監査 (2026-08-06)】
--   上記 4 のほか、Part E に **alias 2 テーブルの拒否 policy** を追加
--   (Advisor 0008_rls_enabled_no_policy 対応、公式推奨の対処)。
--   適合を実測確認した項目: FK 列の index 漏れ 0 件 / `auth.uid()` を使う
--   全 policy が `(select ...)` 包み / GRANT が RLS policy scope と一致 /
--   timestamptz・bigint・text の採用 / 大文字識別子 0 件 /
--   lock_timeout + statement_timeout の設定。
-- ============================================================================

-- ============================================================================
-- Part A: ロック / タイムアウトのガード (0011 と同じ作法)
-- ============================================================================
-- 新規テーブルの作成自体は既存テーブルをロックしないが、FK を張る対象
-- (events / venues / titles / profiles) に SHARE ROW EXCLUSIVE を取る。
-- 待たされ続けて deploy が固まるのを防ぐ。
--
-- ⚠️ `SET LOCAL` はトランザクション内でのみ有効。`supabase db reset` は
--    トランザクション外で流すため `WARNING (25P01)` が出るが**無害**。
--    実 deploy 経路 (`supabase db push`) はトランザクション内で走るため
--    期待どおり効く (2026-08-05 に 3 経路で実測、
--    one-more-time/docs/schema/revolution-profiles-migration.md §4-0)。
--    **明示 `BEGIN` / `COMMIT` でラップしてはいけない** — CLI が既に包んで
--    いる場合、内側の `BEGIN` は no-op になり明示 `COMMIT` が外側の
--    トランザクションを途中でコミットしてしまい、all-or-nothing を壊す。
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

-- ============================================================================
-- Part B: トリガ関数 (private schema)
-- ============================================================================
-- 【なぜ public ではなく private schema なのか】
--   `private` は 0007 で新設した非公開 schema。PostgREST の exposed schema に
--   含まれないため、ここに置いた関数は `/rest/v1/rpc/<name>` から呼べない。
--   既存の `private.handle_new_user()` (0007) / `private.handle_user_deleted()`
--   (0011) と同じ配置に揃える。
--
-- 【なぜ集計 2 本が SECURITY DEFINER なのか — S0 確定版からの変更点 1】
--   トリガ関数は既定 (SECURITY INVOKER) では**発火させたユーザーの権限で
--   実行される**。`apply_review_delta()` は `public.occurrences` と
--   `public.events` を UPDATE するが、Part E の GRANT で authenticated に
--   与えているのは **SELECT だけ**。同様に `apply_review_helpful_delta()` は
--   `public.reviews.helpful_count` を UPDATE するが、authenticated への
--   UPDATE は**列単位 GRANT で helpful_count を除外**している
--   (自己インフレ防止のため、これは緩められない)。
--   → INVOKER のままだと、ログイン中のユーザーがレビューを投稿した瞬間に
--     `permission denied for table occurrences` で失敗する。
--   SECURITY DEFINER にすると関数の所有者 (postgres) 権限で走るため、
--   GRANT を緩めずに集計だけを更新できる。
--
-- 【SECURITY DEFINER を 2 本に絞った理由】
--   残る 3 本 (reject_* 2 本 + set_updated_at) は NEW / OLD を見るだけで
--   他テーブルに触れないため INVOKER のままで動く。SECURITY DEFINER の
--   面積は最小に保つ。
--
-- 【EXECUTE を service_role にしか与えない理由 — ★要実測】
--   Supabase Advisor lint 0029_authenticated_security_definer_function_executable
--   (WARN) は「**user schema の SECURITY DEFINER 関数に authenticated へ
--   EXECUTE を与えたもの**」を全件検出する (`private` も user schema)。
--   PostgreSQL ではトリガ関数の EXECUTE 権限は **CREATE TRIGGER 時**に検査され、
--   発火時には検査されないため、authenticated への GRANT なしで動くはず。
--   ⚠️ ただし 0008 で `supabase_auth_admin` への USAGE + EXECUTE 追加が必要
--      だった前例がある。**ローカル `supabase db reset` 後に
--      `SET ROLE authenticated` で実際にレビューを INSERT して発火を確認する**
--      こと (検証手順は PR 本文のチェックリスト)。
--      もし権限エラーになる場合の対処は以下の順で検討し、**3 は BOSS 判断**:
--        1. `GRANT USAGE ON SCHEMA private TO authenticated` だけで通るか確認
--           (schema USAGE は lint 対象外)
--        2. INVOKER の 3 本だけ EXECUTE を付与 (lint 0029 は DEFINER のみ対象)
--        3. DEFINER 2 本にも EXECUTE 付与 = lint 0029 が 2 件出る
--           → ER doc §6「Advisor が staging/production で zero-diff」を壊すため
--             BOSS へエスカレーションする

-- ───────────────────────────────────────────────
-- B-1. レビュー増減を occurrences / events の集計列へ差分反映
-- ───────────────────────────────────────────────
-- ソフトデリート対応: `deleted_at is null` の行だけを「有効」として加算する。
-- 平均は出さず sum/count をロールアップする (= 企画平均が件数で正しく加重される)。
-- ※ 退会はレビューを消さないため、この集計はノータッチで一貫する。
CREATE OR REPLACE FUNCTION private.apply_review_delta()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_sum bigint := 0;
  old_cnt int := 0;
  new_sum bigint := 0;
  new_cnt int := 0;
  d_sum bigint;
  d_cnt int;
  occ bigint;
  ev bigint;
BEGIN
  -- 変更前の有効寄与
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."deleted_at" IS NULL THEN
    old_sum := OLD."rating";
    old_cnt := 1;
  END IF;
  -- 変更後の有効寄与
  IF TG_OP IN ('UPDATE', 'INSERT') AND NEW."deleted_at" IS NULL THEN
    new_sum := NEW."rating";
    new_cnt := 1;
  END IF;

  d_sum := new_sum - old_sum;
  d_cnt := new_cnt - old_cnt;

  IF d_sum = 0 AND d_cnt = 0 THEN
    RETURN NULL;  -- 集計に影響しない更新 (body 変更等) はスキップ
  END IF;

  occ := COALESCE(NEW."occurrence_id", OLD."occurrence_id");

  UPDATE "public"."occurrences"
     SET "rating_sum" = "rating_sum" + d_sum,
         "rating_count" = "rating_count" + d_cnt
   WHERE "id" = occ
   RETURNING "event_id" INTO ev;

  UPDATE "public"."events"
     SET "rating_sum" = "rating_sum" + d_sum,
         "rating_count" = "rating_count" + d_cnt
   WHERE "id" = ev;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.apply_review_delta() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.apply_review_delta() TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B-2. reviews.occurrence_id の付け替え禁止
-- ───────────────────────────────────────────────
-- `apply_review_delta()` は UPDATE 時に `occ := coalesce(new.occurrence_id, ...)`
-- で **付け替え後の occurrence にしか差分を当てない**。そのためレビューを
-- 開催 A → B へ付け替えると集計が壊れる:
--   - rating が変わらない場合: d_sum = d_cnt = 0 で早期 return するため
--     **A にも B にも反映されない**
--   - rating も変わる場合: 差分は B にのみ適用され **A の元の寄与が取り残される**
--
-- RLS の with check は「verified な occurrence であること」しか見ないため、
-- **verified 同士の付け替えは policy では防げない**。
--
-- ⚠️ 本トリガは **service_role もバイパスできない** (RLS ではなく通常のトリガ)。
--    取り込みパイプラインのバグ等で誤った occurrence に紐付いたレビューを
--    運用側で付け替えたくなった場合も一律ブロックされる。**これは意図した挙動**で、
--    service_role に例外を設けると集計破壊そのものを許すことになるため緩めない。
--    どうしても必要な場合は DELETE → 正しい occurrence_id で INSERT し直す
--    (両分岐で集計が正しく増減する)。ただし id / created_at は変わる。
CREATE OR REPLACE FUNCTION private.reject_review_occurrence_change()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."occurrence_id" IS DISTINCT FROM OLD."occurrence_id" THEN
    RAISE EXCEPTION
      'reviews.occurrence_id は変更できません (review id=%, % -> %)',
      OLD."id", OLD."occurrence_id", NEW."occurrence_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.reject_review_occurrence_change() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.reject_review_occurrence_change() TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B-3. review_images.review_id の付け替え禁止
-- ───────────────────────────────────────────────
-- RLS だけでは「**自分が所有する別のアクティブなレビュー**への付け替え」を
-- 防げない (using / with check は「自分の未削除レビューに属するか」しか見ない
-- ため、A も B も自分のものなら両方を通過する)。
-- 集計キャッシュには影響しないが、**写真は特定の開催で撮られたもの**であり、
-- 別開催のレビューに移せると「会場 X の写真が会場 Y のレビューに並ぶ」誤表示
-- になる。閲覧者から見た情報の正しさに関わるため occurrence_id と同じ扱いで禁止。
CREATE OR REPLACE FUNCTION private.reject_review_image_review_change()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."review_id" IS DISTINCT FROM OLD."review_id" THEN
    RAISE EXCEPTION
      'review_images.review_id は変更できません (image id=%, % -> %)',
      OLD."id", OLD."review_id", NEW."review_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.reject_review_image_review_change() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.reject_review_image_review_change() TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B-4. reviews.updated_at 自動更新
-- ───────────────────────────────────────────────
-- 名前を `set_updated_at` ではなく `set_reviews_updated_at` にしている。
-- 汎用名だと将来 profiles 等に別トリガを足したくなった時に「どのテーブル用か」
-- が読めなくなるため (`profiles.updated_at` の BEFORE UPDATE トリガは
-- Backlog 6gr4PQvR8p9QCRgg で別途検討中)。
CREATE OR REPLACE FUNCTION private.set_reviews_updated_at()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.set_reviews_updated_at() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_reviews_updated_at() TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- B-5. reviews.helpful_count の集計キャッシュ (★案 A、2026-08-02 BOSS 確定)
-- ───────────────────────────────────────────────
-- 「参考になった」の件数を匿名ユーザーにも見せるための非正規化キャッシュ。
-- `review_helpful` 本体は本人の行しか見えない (誰が押したかは非公開) ため、
-- 件数は reviews 側に持たせて公開する。
-- `rating_sum` / `rating_count` と同じパターンで、本プロジェクトに前例がある。
--
-- review_helpful に UPDATE policy はなく PK が (review_id, user_id) の 2 列のみ
-- のため、更新経路は INSERT / DELETE だけ。
CREATE OR REPLACE FUNCTION private.apply_review_helpful_delta()
RETURNS trigger
SET search_path = ''
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "public"."reviews"
       SET "helpful_count" = "helpful_count" + 1
     WHERE "id" = NEW."review_id";
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "public"."reviews"
       SET "helpful_count" = "helpful_count" - 1
     WHERE "id" = OLD."review_id";
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION private.apply_review_helpful_delta() FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.apply_review_helpful_delta() TO service_role;
--> statement-breakpoint

-- ============================================================================
-- Part C: トリガ
-- ============================================================================
CREATE TRIGGER trg_review_delta
AFTER INSERT OR UPDATE OR DELETE ON "public"."reviews"
FOR EACH ROW EXECUTE FUNCTION private.apply_review_delta();
--> statement-breakpoint

-- `UPDATE OF occurrence_id` は当該列が SET 句に現れた時だけ発火する
-- (値が同じでも発火するため、関数内の IS DISTINCT FROM で実質変更のみ弾く)。
CREATE TRIGGER trg_reviews_freeze_occurrence
BEFORE UPDATE OF "occurrence_id" ON "public"."reviews"
FOR EACH ROW EXECUTE FUNCTION private.reject_review_occurrence_change();
--> statement-breakpoint

CREATE TRIGGER trg_review_images_freeze_review
BEFORE UPDATE OF "review_id" ON "public"."review_images"
FOR EACH ROW EXECUTE FUNCTION private.reject_review_image_review_change();
--> statement-breakpoint

-- `UPDATE OF <列>` で **本文系の列が変わった時だけ**発火させる。
-- 無指定 (BEFORE UPDATE ON reviews) だと helpful_count の増減
-- (trg_review_helpful_delta 経由) でも updated_at が動き、
-- 「他人が『参考になった』を押しただけで投稿者が編集したように見える」ため。
CREATE TRIGGER trg_reviews_updated_at
BEFORE UPDATE OF "rating", "body", "visited_on", "deleted_at" ON "public"."reviews"
FOR EACH ROW EXECUTE FUNCTION private.set_reviews_updated_at();
--> statement-breakpoint

CREATE TRIGGER trg_review_helpful_delta
AFTER INSERT OR DELETE ON "public"."review_helpful"
FOR EACH ROW EXECUTE FUNCTION private.apply_review_helpful_delta();
--> statement-breakpoint

-- ============================================================================
-- Part D: occurrence_view (開催状態の導出、JST 固定)
-- ============================================================================
-- 開催状態は保存せず日付から導出する。中止だけ cancelled_at で実体保持。
--   scheduled : 開催前 / ongoing : 開催中 / ended : 終了 / cancelled : 中止
--
-- 【security_invoker = on を付けた理由 — S0 確定版からの変更点 2】
--   PostgreSQL の view は既定が **SECURITY DEFINER 相当**で、view 作成者の
--   権限で基底テーブルを読む = **RLS をバイパスする**。この view をそのまま
--   anon に見せると `occurrences_select_verified` が効かず、
--   **未承認 (verified = false) の開催が公開されてしまう**。
--   Supabase Advisor lint 0010_security_definer_view は **ERROR レベル**。
--   出典: https://supabase.com/docs/guides/database/database-advisors?lint=0010_security_definer_view
--   `security_invoker = on` (PG15+) で呼び出し元の権限で評価され、基底の RLS が
--   そのまま効く。
--
-- 【ends_on IS NULL を明示分岐にした理由】
--   ★決定⑤ で ends_on を nullable 化した (null = 終了日未定 / 常設)。
--   `(now() ...)::date > NULL` は NULL を返すので CASE は次の分岐へ落ち、
--   結果的に 'ongoing' になる = **偶然正しい**。しかし「意図してそうなのか
--   NULL 伝播の副作用なのか」が読めないため、明示的な分岐を先に置く。
CREATE VIEW "public"."occurrence_view"
WITH (security_invoker = on) AS
SELECT
  o.*,
  CASE
    WHEN o."cancelled_at" IS NOT NULL THEN 'cancelled'
    WHEN (now() AT TIME ZONE 'Asia/Tokyo')::date < o."starts_on" THEN 'scheduled'
    -- ★決定⑤: 終了日未定 / 常設。開始済みなら終わらない。
    WHEN o."ends_on" IS NULL THEN 'ongoing'
    WHEN (now() AT TIME ZONE 'Asia/Tokyo')::date > o."ends_on" THEN 'ended'
    ELSE 'ongoing'
  END AS "status"
FROM "public"."occurrences" o;
--> statement-breakpoint

-- 参考: 「開催中」の取得は view に頼らず日付範囲で直接引ける
-- (occurrences_dates_idx が効く)。**ends_on IS NULL を落とさないこと** —
-- `ends_on >= current_date` だけだと常設開催が結果から消える。
-- また `current_date` はサーバ TZ (UTC) 基準なので、view と揃えるなら
-- JST に寄せる:
--   SELECT * FROM public.occurrences
--    WHERE cancelled_at IS NULL
--      AND starts_on <= (now() AT TIME ZONE 'Asia/Tokyo')::date
--      AND (ends_on IS NULL OR ends_on >= (now() AT TIME ZONE 'Asia/Tokyo')::date);

REVOKE ALL ON TABLE "public"."occurrence_view" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."occurrence_view" TO anon, authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."occurrence_view" TO service_role;
--> statement-breakpoint

-- ============================================================================
-- Part E: RLS + GRANT
-- ============================================================================
-- 【本プロジェクトの規約 (migration 0001-0009 から抽出)】
--   1. RLS を有効化しただけで policy を書かないテーブルを作らない
--      (未設定だと Advisor `rls_disabled_in_public` が出る)。
--      ただし *_aliases は「policy を作らない = 0 行」が意図した設計なので例外。
--   2. **GRANT は RLS policy scope と厳密に一致させる** (migration 0006 の規約)。
--      RLS が honor しない権限は dead grant であり、RLS を将来誤って停止した
--      場合の blast radius を無用に拡大する。
--      Supabase managed project の `pg_default_acl` は新規テーブルに broad な
--      権限を cascade させる仕様のため、**REVOKE ALL してから明示 GRANT** する。
--   3. **関数呼び出しは `(select ...)` で包む**。Postgres の initPlan により
--      per-statement で 1 回だけ評価される (行ごとに評価しない)。
--      出典: https://supabase.com/docs/guides/database/postgres/row-level-security
--   4. **他テーブル参照は join でなく `IN (select ...)`** (公式「Minimize joins」)。
--   5. **policy の述語で使う列には index を張る** (本 migration で全て作成済み)。
--
-- 【SECURITY DEFINER ヘルパー関数を採用しなかった理由】
--   Supabase 公式は RLS から他テーブルを参照する際に `private.has_good_role()`
--   のような SECURITY DEFINER 関数を推奨しているが、**採用しない**。
--   policy から呼ぶには authenticated に EXECUTE を与える必要があり、
--   Advisor 0029 が新規発生して ER doc §6 の「Advisor が zero-diff」を壊す。
--   参照先が profiles 1 テーブルのみで `IN (select ...)` で十分表現できる現状
--   では、lint を増やしてまで導入する利得がない。
--
-- 【★ profiles の RLS との結合 (M1 = 0011 との依存関係)】
--   reviews / review_images / review_helpful の書き込み policy は
--   `user_id in (select p.id from public.profiles p
--                 where p.auth_user_id = (select auth.uid()))`
--   の形で **profiles を参照する**。policy 式は呼び出しユーザー権限で評価される
--   ため、**この副問い合わせにも profiles 自身の RLS が適用される**。
--   0011 で `profiles_select_own` を `auth_user_id` 基準へ書き換え済みのため
--   成立する。M1 前は 0 行を返して全書き込みが失敗した。

-- ───────────────────────────────────────────────
-- E-1. occurrences — 公開は verified = true のみ (★決定⑧)
--      書き込みは取り込みパイプライン (service_role) 専用
-- ───────────────────────────────────────────────
ALTER TABLE "public"."occurrences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 未承認 (verified = false) の開催をページに出さないための中核。
-- 承認キュー (verified = false を一覧する管理画面) は service_role で読む。
CREATE POLICY "occurrences_select_verified"
  ON "public"."occurrences"
  FOR SELECT
  TO anon, authenticated
  USING ("verified");
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."occurrences" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."occurrences" TO anon, authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."occurrences" TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- E-2. title_aliases / venue_aliases — service_role のみ
-- ───────────────────────────────────────────────
-- anon / authenticated からは 0 行にする。service_role は BYPASSRLS のため
-- 影響を受けない。
-- ★ 2026-08-02 BOSS 確定: **非公開のまま**とする (根拠は db/title-aliases.ts)。
ALTER TABLE "public"."title_aliases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."venue_aliases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ★ 明示的な**拒否 policy**を置く (`using (false)`)。
--   「RLS 有効 + policy ゼロ」でも anon / authenticated からは 0 行になるが、
--   その状態は Supabase Advisor の
--     0008_rls_enabled_no_policy (INFO)
--   に該当し、ER doc §6 の「Advisor が staging / production で zero-diff」を
--   常時 2 件分崩す。
--   公式 doc がこのケースの対処を明記している:
--     "some users may enable RLS with no policies intentionally to restrict
--      access over APIs. In those cases we recommend making that intent
--      explicit with a rejection policy"
--     https://supabase.com/docs/guides/database/database-advisors?lint=0008_rls_enabled_no_policy
--   挙動は変わらない (service_role は従来どおり読め、anon は REVOKE ALL により
--   42501 のまま)。**「policy を書き忘れた」のではなく「意図的に非公開」**で
--   あることを schema 上に明示するのが目的。
CREATE POLICY "title_aliases_none_shall_pass"
  ON "public"."title_aliases"
  FOR SELECT
  TO anon, authenticated
  USING (false);
--> statement-breakpoint

CREATE POLICY "venue_aliases_none_shall_pass"
  ON "public"."venue_aliases"
  FOR SELECT
  TO anon, authenticated
  USING (false);
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."title_aliases" FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."venue_aliases" FROM anon, authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."title_aliases" TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."venue_aliases" TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- E-3. reviews — 閲覧は全員 (未削除のみ) / 書き込みは本人のみ
-- ───────────────────────────────────────────────
ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ソフトデリート済みは誰にも見せない (投稿者本人にも)。
--
-- ※ 親 occurrence の verified は **意図的に見ていない**。
--   前提「未承認の開催に付いたレビューは発生しない」は UI の制約ではなく
--   **下の INSERT / UPDATE policy が with check で DB 層に強制している**。
--   この条件を SELECT にも足すと **全レビュー読み取りに occurrences への
--   副問い合わせが乗る** (レビュー一覧は最も頻繁に叩かれる公開クエリ)。
--   残存経路は「一度 verified にした開催を後から false に戻した場合、その
--   レビューだけ読めてしまう」ケースのみ。現時点で差し戻し運用は存在しない。
--   差し戻しを導入するなら S4 で下記に切り替える:
--     USING (deleted_at IS NULL
--            AND occurrence_id IN (SELECT o.id FROM public.occurrences o WHERE o.verified))
CREATE POLICY "reviews_select_public"
  ON "public"."reviews"
  FOR SELECT
  TO anon, authenticated
  USING ("deleted_at" IS NULL);
--> statement-breakpoint

-- occurrence 存在チェックは **必須**。これがないと authenticated ユーザーが
-- PostgREST を直接叩いて verified = false の occurrence にレビューを INSERT
-- できる (occurrences.id は連番 bigint なので未承認 ID は推測可能)。
-- その場合 apply_review_delta() が発火して **親 events.rating_* まで更新される**
-- ため、occurrence 自体は非公開のまま**親イベントの公開評価だけが汚染**される
-- (原因が画面に出ないため検知も困難)。
CREATE POLICY "reviews_insert_self"
  ON "public"."reviews"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
    AND "occurrence_id" IN (
      SELECT o."id" FROM "public"."occurrences" o WHERE o."verified"
    )
  );
--> statement-breakpoint

-- using = 対象行の判定、with check = 更新後の値の判定。
-- 両方に本人述語を置き、他人の行への付け替えを防ぐ (profiles_update_own と同じ作法)。
-- **削除はこの UPDATE で deleted_at を立てる** (ソフトデリート)。
--
-- with check 側にだけ occurrence 条件を足す (using には足さない):
--   - with check にないと、既存レビューの occurrence_id を未承認 occurrence へ
--     **付け替える**ことで INSERT と同じ汚染ができてしまう
--   - using に足すと、開催が後から未承認へ戻された時に本人が自分のレビューを
--     **編集も撤回もできなくなる**ため足さない
--
-- ※ この with check が防ぐのは「**未承認**の occurrence への付け替え」だけ。
--   **verified 同士の付け替え**は policy では防げず集計が壊れるため、
--   trg_reviews_freeze_occurrence (Part C) で禁止している。
--
-- ⚠️ 上記の非対称 (using に occurrence 条件なし / with check にあり) の帰結:
--   開催が verified → false へ差し戻された場合、そのレビューの所有者は UPDATE
--   自体が with check で弾かれ、編集も撤回 (soft delete) もできなくなる。
--   現時点で差し戻し運用は存在しないため実害はないが、**S4 で差し戻しを導入
--   するなら本 policy の再設計が必要** (例: deleted_at のみを変える更新を別
--   policy で許可する)。
CREATE POLICY "reviews_update_self"
  ON "public"."reviews"
  FOR UPDATE
  TO authenticated
  USING (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
    AND "occurrence_id" IN (
      SELECT o."id" FROM "public"."occurrences" o WHERE o."verified"
    )
  );
--> statement-breakpoint

-- DELETE policy は作らない。
-- reviews は occurrences / events の集計キャッシュ (rating_sum / rating_count) と
-- 対になっており、物理削除は apply_review_delta() の DELETE 分岐でしか整合が
-- 取れない。運用上の「削除」は上記 UPDATE による deleted_at で行う。
REVOKE ALL ON TABLE "public"."reviews" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."reviews" TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."reviews" TO authenticated;
--> statement-breakpoint

-- ★ UPDATE は **列単位**で絞る (2026-08-02、案 A 採用に伴う必須の対策)。
--   reviews_update_self は「本人の行か」しか見ないため、テーブル単位で UPDATE を
--   与えると **本人が自分のレビューの helpful_count を直接書き換えられる**
--   (helpful_count = 9999 の自己申告)。列単位 GRANT なら Postgres が権限段階で弾く。
--   occurrence_id / user_id / id / created_at / updated_at を除いているのも同じ理由。
--   ※ occurrence_id は trg_reviews_freeze_occurrence でも守っているが、そちらは
--     service_role にも効かせるための多層防御。ここは authenticated 向け。
GRANT UPDATE ("rating", "body", "visited_on", "deleted_at")
    ON TABLE "public"."reviews" TO authenticated;
--> statement-breakpoint

GRANT ALL ON TABLE "public"."reviews" TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- E-4. review_images — 親レビューが見えるなら見える / 書き込みは親の所有者のみ
-- ───────────────────────────────────────────────
ALTER TABLE "public"."review_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 親 reviews にも RLS が効くため deleted_at の条件は暗黙にも成立するが、
-- 「reviews の policy を変えたら images の可視性が黙って変わる」状態を避けるため
-- **本テーブルの全 policy で明示的に書く** (冗長だが意図が読める)。
--
-- ※ **親 occurrence の verified は見ていない (reviews との非対称、意図的)**。
--   reviews_update_self は with check に occurrence 条件を持つため、開催が
--   差し戻されると本体の編集・撤回が凍結される。一方 review_images 側は
--   deleted_at しか見ないため、**同じ状況でも画像の追加・並べ替え・削除は
--   凍結されない**。現時点で差し戻し運用は存在せず実害はないが、この非対称は
--   「見落とし」ではなく「差し戻し運用が無いので条件を足していない」という状態。
--   **S4 で差し戻しを設計する際は reviews と本テーブルを一体で再設計すること**。
CREATE POLICY "review_images_select_public"
  ON "public"."review_images"
  FOR SELECT
  TO anon, authenticated
  USING (
    "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint

CREATE POLICY "review_images_insert_own"
  ON "public"."review_images"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."deleted_at" IS NULL
         AND r."user_id" IN (
           SELECT p."id" FROM "public"."profiles" p
            WHERE p."auth_user_id" = (SELECT auth.uid())
         )
    )
  );
--> statement-breakpoint

-- UPDATE は sort_order の並べ替えのために必要 (10 枚のギャラリーを
-- delete + insert で並べ替えると R2 のオブジェクトまで作り直しになる)。
CREATE POLICY "review_images_update_own"
  ON "public"."review_images"
  FOR UPDATE
  TO authenticated
  USING (
    "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."deleted_at" IS NULL
         AND r."user_id" IN (
           SELECT p."id" FROM "public"."profiles" p
            WHERE p."auth_user_id" = (SELECT auth.uid())
         )
    )
  )
  WITH CHECK (
    "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."deleted_at" IS NULL
         AND r."user_id" IN (
           SELECT p."id" FROM "public"."profiles" p
            WHERE p."auth_user_id" = (SELECT auth.uid())
         )
    )
  );
--> statement-breakpoint

-- 画像は reviews と違い集計キャッシュを持たないため物理削除でよい。
-- (R2 オブジェクトの回収は created_at を使う孤児回収ジョブが別途担当する)
CREATE POLICY "review_images_delete_own"
  ON "public"."review_images"
  FOR DELETE
  TO authenticated
  USING (
    "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."deleted_at" IS NULL
         AND r."user_id" IN (
           SELECT p."id" FROM "public"."profiles" p
            WHERE p."auth_user_id" = (SELECT auth.uid())
         )
    )
  );
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."review_images" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."review_images" TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."review_images" TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."review_images" TO service_role;
--> statement-breakpoint

-- ───────────────────────────────────────────────
-- E-5. review_helpful — 「参考になった」。自分の行のみ可視
-- ───────────────────────────────────────────────
ALTER TABLE "public"."review_helpful" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ★ 件数の公開方法は **案 A で確定済み**。
-- 「誰がどのレビューを参考にしたか」は公開せず、自分の行だけ見える形にする
-- (UI の「押下済み」状態の復元に必要)。**匿名ユーザー向けの件数は
-- reviews.helpful_count に集約**され、本テーブルを読ませる必要はない。
CREATE POLICY "review_helpful_select_own"
  ON "public"."review_helpful"
  FOR SELECT
  TO authenticated
  USING (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- review_id 条件は **必須**。他の policy と違い本 policy は reviews を一切参照
-- しないため、RLS の合成による暗黙の絞り込みが効かない。これがないと
-- ソフトデリート済みのレビューにも「参考になった」を打てる。
-- 案 A (reviews.helpful_count + トリガ) により、**不可視のレビューのカウンタが
-- 動く**ことになるため実害が出る。
CREATE POLICY "review_helpful_insert_self"
  ON "public"."review_helpful"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
    AND "review_id" IN (
      SELECT r."id" FROM "public"."reviews" r WHERE r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint

-- トグル解除。favorites と同じく UPDATE はなく INSERT + DELETE で表現する。
CREATE POLICY "review_helpful_delete_self"
  ON "public"."review_helpful"
  FOR DELETE
  TO authenticated
  USING (
    "user_id" IN (
      SELECT p."id" FROM "public"."profiles" p
       WHERE p."auth_user_id" = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."review_helpful" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "public"."review_helpful" TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE "public"."review_helpful" TO service_role;
