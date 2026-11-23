-- 0025: 写真の SELECT の policy を、役割ごとに 1 つにまとめる (one-more-time #164 の追い)
--
-- 0024 で足した公開の policy が、authenticated では本人の policy (0021) と重なっていた。Supabase の
-- Advisor が「同じ役割・操作に permissive な policy が複数ある (行ごとに両方を評価する)」と出す
-- (multiple_permissive_policies)。reviews と同じく、anon は公開だけ、authenticated は公開か本人の
-- どちらかを 1 つの policy で見る。見える行は変えない:
--   - 公開: 公開中で論理削除していない口コミの、非公開でない写真
--   - 本人: 論理削除していない自分の口コミの写真 (非公開の写真も。マイページで理由を見せる)

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS "review_images_select_public" ON "public"."review_images";
--> statement-breakpoint
DROP POLICY IF EXISTS "review_images_select_own" ON "public"."review_images";
--> statement-breakpoint
CREATE POLICY "review_images_select_published" ON "public"."review_images"
  AS PERMISSIVE FOR SELECT TO "anon"
  USING (
    "hidden_at" IS NULL
    AND EXISTS (
      SELECT 1 FROM "public"."reviews" r
      WHERE r."id" = "review_images"."review_id"
        AND r."status" = 'published' AND r."deleted_at" IS NULL
    )
  );
--> statement-breakpoint
CREATE POLICY "review_images_select_published_or_own" ON "public"."review_images"
  AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."reviews" r
      WHERE r."id" = "review_images"."review_id"
        AND r."deleted_at" IS NULL
        AND (
          (r."status" = 'published' AND "review_images"."hidden_at" IS NULL)
          OR r."user_id" IN (
            SELECT p."id" FROM "public"."profiles" p
             WHERE p."auth_user_id" = (SELECT auth.uid())
          )
        )
    )
  );
