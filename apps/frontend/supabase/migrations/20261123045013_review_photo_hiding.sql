-- 0023: 写真ごとの非公開 (one-more-time #164)
--
-- AI の審査で 1 枚だけ問題があった時に、口コミは公開してその写真だけを出さない。理由は本人にだけ
-- マイページで見せる (列は本人の SELECT で読める。公開の読み出しは非公開の写真を出さない: #3 は次の PR)。
-- 書くのは審査とサーバー (service role) だけ。authenticated には UPDATE の GRANT が sort_order しか無い (0015)。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."review_images" ADD COLUMN "hidden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD COLUMN "hidden_reason_code" text;
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD CONSTRAINT "review_images_hidden_reason_chk"
  CHECK ("hidden_reason_code" IS NULL OR "hidden_reason_code" IN ('personal_info', 'abuse', 'spam', 'resale'));
--> statement-breakpoint
ALTER TABLE "public"."review_images" ADD CONSTRAINT "review_images_hidden_pair_chk"
  CHECK (("hidden_at" IS NULL) = ("hidden_reason_code" IS NULL));
