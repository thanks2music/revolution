/**
 * 環境変数の型安全なスキーマ定義
 * @t3-oss/env-nextjs を使用して、必須環境変数の検証とTypeScript型推論を提供
 */

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /*
   * サーバーサイド環境変数
   * NEXT_PUBLIC_ プレフィックスなし
   * サーバーコンポーネント、API Routes、Middlewareでのみアクセス可能
   */
  server: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // ---------------------------------------------------------------
    // Crescendolls (Supabase 会員機能) — server-only シークレット
    // ---------------------------------------------------------------
    // RLS をバイパスする Secret Key（commit 禁止）。
    // 用途は username 重複 count の Server Action 等に限定（M2 以降で使用）。
    // M0 では未使用のため optional。実際に server 処理で使う Sprint で
    // 利用箇所側が存在チェックを行う。
    SUPABASE_SECRET_KEY: z
      .string()
      .startsWith("sb_secret_", {
        message: "SUPABASE_SECRET_KEY は modern secret key (sb_secret_...) を指定してください",
      })
      .optional(),

    // postgres-js (Drizzle, prepare:false) で使用する接続文字列。
    // Supabase Dashboard → Connect → Transaction pooler (6543)。M1 以降で使用。
    DATABASE_URL: z.string().url().optional(),

    // drizzle-kit / migrate を max:1 で使用する接続文字列。
    // Supabase Dashboard → Connect → Session pooler (5432)。M1 以降で使用。
    MIGRATION_DATABASE_URL: z.string().url().optional(),

    // Slack 通知 (lib/slack/notify.ts)。未設定なら通知しないだけなので、すべて optional。
    // ⚠️ ここに書くのは env レジストリとしての記録が目的で、送信側は `process.env` を直読みする
    // (NEXT_PUBLIC_SENTRY_DSN と同じ扱い。テストで env を差し替えられるようにするため)。
    SLACK_BOT_TOKEN: z.string().optional(),
    // 要対応 (BOSS へのメンション付き) / お知らせ (メンションなし) のチャンネル ID
    SLACK_ATTENTION_CHANNEL_ID: z.string().optional(),
    SLACK_NOTICE_CHANNEL_ID: z.string().optional(),
    // 要対応で鳴らすユーザー ID。Vercel では Production にだけ設定する
    SLACK_MENTION_USER_ID: z.string().optional(),

    // 口コミの AI 審査 (lib/reviews/screener)。Slack と同じく、ここは env レジストリとしての記録で、
    // 審査器は `process.env` を直読みする (テストで env を差し替えるため)。未設定なら審査は失敗として扱う
    GEMINI_API_KEY: z.string().optional(),
    REVIEW_SCREENING_MODEL: z.string().optional(),
    // fake の時だけ偽物を使う。ほかの値は無視する (値の誤りで起動を止めないため)
    REVIEW_SCREENER: z.string().optional(),

    // 口コミの写真の置き場所 (lib/reviews/photos/storage.ts)。審査器と同じく env レジストリとしての記録で、
    // 置き場所は `process.env` を直読みする。5 つそろわなければ写真を付けられない (口コミ自体は書ける)
    REVIEW_R2_ENDPOINT: z.string().optional(),
    REVIEW_R2_ACCESS_KEY_ID: z.string().optional(),
    REVIEW_R2_SECRET_ACCESS_KEY: z.string().optional(),
    REVIEW_R2_INTAKE_BUCKET: z.string().optional(),
    REVIEW_R2_PHOTO_BUCKET: z.string().optional(),
    // fake の時だけ偽物 (ファイル) を使う。手元と E2E の確認用
    REVIEW_PHOTO_STORAGE: z.string().optional(),
  },

  /*
   * クライアントサイド環境変数
   * NEXT_PUBLIC_ プレフィックス必須
   * ブラウザでもアクセス可能（バンドルに含まれる）
   */
  client: {
    // ---------------------------------------------------------------
    // Crescendolls (Supabase 会員機能) — 公開クライアント設定
    // ---------------------------------------------------------------
    // Supabase プロジェクト URL。browser/server/middleware の Supabase
    // クライアント生成に必須。欠落時は起動エラーにして配線ミスを早期検知する。
    NEXT_PUBLIC_SUPABASE_URL: z.string().url({
      message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL (e.g., https://<ref>.supabase.co)"
    }),

    // modern publishable key (sb_publishable_...)。anon key の後継。
    // browser/server/middleware の Supabase クライアント生成に必須。
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_", {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY は modern publishable key (sb_publishable_...) を指定してください"
    }),

    // 公開用サイトURL（OGPやサイトマップで使用）
    NEXT_PUBLIC_SITE_URL: z.string().url({
      message: "NEXT_PUBLIC_SITE_URL must be a valid URL (e.g., https://example.com)"
    }).optional(),

    // サイト名（メタデータで使用）
    // 「Revolution」はリポジトリのコードネームであってサイト名ではない。
    // ユーザーに見える名称は「アニイベ」で、本キーがその単一の真実源。
    // 例外: ヘッダーとフッターのロゴの文字は画像 (public/images/logo-horizontal.svg) に
    // 描かれていて、本キーに従わない。本キーから作るのはロゴのリンクの名前 (alt) だけ。
    NEXT_PUBLIC_SITE_NAME: z.string().min(1).default("アニイベ"),

    // サイト説明（メタデータで使用）
    NEXT_PUBLIC_SITE_DESCRIPTION: z
      .string()
      .min(1)
      .default("推し活イベントに行った体験・思い出を記録・レビュー・口コミできるアニイベ。コラボカフェやポップアップなど、アニメ・漫画・映画・音楽のイベント情報も掲載！"),

    // Sentry の DSN。
    // ⚠️ ここに書くのは **env レジストリとしての記録** が目的で、SDK 初期化側は
    // `process.env` を直読みする (instrumentation-client.ts / sentry.*.config.ts)。
    // SKIP_ENV_VALIDATION 付きの CI build や client bootstrap を t3-env に結合させないため。
    // 未設定でも SDK は無言で no-op になるだけなので optional とする。
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  },

  /*
   * ランタイム環境変数のマッピング
   * destructuring はパフォーマンスのため推奨されない
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_ATTENTION_CHANNEL_ID: process.env.SLACK_ATTENTION_CHANNEL_ID,
    SLACK_NOTICE_CHANNEL_ID: process.env.SLACK_NOTICE_CHANNEL_ID,
    SLACK_MENTION_USER_ID: process.env.SLACK_MENTION_USER_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    REVIEW_SCREENING_MODEL: process.env.REVIEW_SCREENING_MODEL,
    REVIEW_SCREENER: process.env.REVIEW_SCREENER,
    REVIEW_R2_ENDPOINT: process.env.REVIEW_R2_ENDPOINT,
    REVIEW_R2_ACCESS_KEY_ID: process.env.REVIEW_R2_ACCESS_KEY_ID,
    REVIEW_R2_SECRET_ACCESS_KEY: process.env.REVIEW_R2_SECRET_ACCESS_KEY,
    REVIEW_R2_INTAKE_BUCKET: process.env.REVIEW_R2_INTAKE_BUCKET,
    REVIEW_R2_PHOTO_BUCKET: process.env.REVIEW_R2_PHOTO_BUCKET,
    REVIEW_PHOTO_STORAGE: process.env.REVIEW_PHOTO_STORAGE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },

  /*
   * CI/CDでの実行をスキップ
   * ビルド時に環境変数が揃っていない場合に便利
   */
  // 明示的な真値のみで skip する。`!!process.env.SKIP_ENV_VALIDATION` は文字列
  // "false" も truthy になり、意図せず検証を無効化する事故を招くため厳密一致で判定する。
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.SKIP_ENV_VALIDATION === "1",

  /*
   * エラーメッセージを判別しやすく設定
   */
  emptyStringAsUndefined: true,
});

/**
 * 型推論されたenv objectをexport
 * TypeScriptでの型安全なアクセスが可能
 *
 * 使用例：
 * ```typescript
 * import { env } from '@/lib/env';
 *
 * // 型安全にアクセス
 * const siteUrl = env.NEXT_PUBLIC_SITE_URL;
 * ```
 */
