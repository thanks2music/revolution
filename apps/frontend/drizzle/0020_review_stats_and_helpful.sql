-- 0020: 開催ごとの口コミの集計のビューと、「参考になった」を公開中の口コミだけにする (S4 口コミ #165)
--
-- 集計: 星の分布・参加のしかた・飲食代の帯・グッズ代の帯の件数を、公開中で論理削除していない口コミから数える。
-- 件数が小さく、開催のページは ISR なので、キャッシュの列は持たない (仕様 #156「集計」)。
-- security_invoker なので、読む役割の RLS (公開中だけ) と列の権限がそのまま効く。WHERE でも公開中に絞り、
-- service role で読んでも公開中だけを数える。
-- 「費用は 3 件そろうまで出さない」は、項目ごとの回答数で表示の層が判定する (仕様)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint

CREATE VIEW "public"."occurrence_review_stats"
WITH (security_invoker = on) AS
SELECT r."occurrence_id", 'rating'::text AS "dimension", r."rating"::text AS "value", count(*)::integer AS "count"
  FROM "public"."reviews" r
 WHERE r."status" = 'published' AND r."deleted_at" IS NULL AND r."rating" IS NOT NULL
 GROUP BY r."occurrence_id", r."rating"
UNION ALL
SELECT r."occurrence_id", 'attendance', r."attendance", count(*)::integer
  FROM "public"."reviews" r
 WHERE r."status" = 'published' AND r."deleted_at" IS NULL AND r."attendance" IS NOT NULL
 GROUP BY r."occurrence_id", r."attendance"
UNION ALL
SELECT r."occurrence_id", 'food_cost_band', r."food_cost_band", count(*)::integer
  FROM "public"."reviews" r
 WHERE r."status" = 'published' AND r."deleted_at" IS NULL AND r."food_cost_band" IS NOT NULL
 GROUP BY r."occurrence_id", r."food_cost_band"
UNION ALL
SELECT r."occurrence_id", 'goods_cost_band', r."goods_cost_band", count(*)::integer
  FROM "public"."reviews" r
 WHERE r."status" = 'published' AND r."deleted_at" IS NULL AND r."goods_cost_band" IS NOT NULL
 GROUP BY r."occurrence_id", r."goods_cost_band";
--> statement-breakpoint

REVOKE ALL ON TABLE "public"."occurrence_review_stats" FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE "public"."occurrence_review_stats" TO anon, authenticated, service_role;
--> statement-breakpoint

-- 「参考になった」は公開中の口コミにだけ付けられる (仕様 #156)。0011 の policy は「論理削除していない」だけを
-- 見ていて、本人の下書きや審査中の口コミにも付けられた
DROP POLICY "review_helpful_insert_self" ON "public"."review_helpful";
--> statement-breakpoint
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
      SELECT r."id" FROM "public"."reviews" r
       WHERE r."status" = 'published' AND r."deleted_at" IS NULL
    )
  );
