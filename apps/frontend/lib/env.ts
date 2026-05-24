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

    // WordPress GraphQL エンドポイント（サーバー側で使用可能）
    WORDPRESS_GRAPHQL_ENDPOINT: z.string().url().optional(),

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
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1, {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (sb_publishable_...)"
    }),

    // 公開用サイトURL（OGPやサイトマップで使用）
    NEXT_PUBLIC_SITE_URL: z.string().url({
      message: "NEXT_PUBLIC_SITE_URL must be a valid URL (e.g., https://example.com)"
    }).optional(),

    // WordPress GraphQL エンドポイント（公開用）
    // MDX専用モードでは任意（WordPress統合時は必須）
    NEXT_PUBLIC_WP_ENDPOINT: z.string().url({
      message: "NEXT_PUBLIC_WP_ENDPOINT must be a valid URL (e.g., https://example.com/graphql)"
    }).optional(),

    // WordPress サイトURL（OGP画像等で使用）
    NEXT_PUBLIC_WP_URL: z.string().url({
      message: "NEXT_PUBLIC_WP_URL must be a valid URL (e.g., https://example.com)"
    }).optional(),

    // 画像最適化で許可するホスト
    // 本番環境では必須、開発環境ではlocalhostがデフォルト
    NEXT_PUBLIC_ALLOWED_IMAGE_HOST: z.string().min(1, {
      message: "NEXT_PUBLIC_ALLOWED_IMAGE_HOST must be set (e.g., 'example.com')"
    }).optional(),

    // サイト名（メタデータで使用）
    NEXT_PUBLIC_SITE_NAME: z.string().min(1).default("Revolution Platform"),

    // サイト説明（メタデータで使用）
    NEXT_PUBLIC_SITE_DESCRIPTION: z
      .string()
      .min(1)
      .default("Next.js + WordPress Headless CMS"),

    // デバッグモード
    NEXT_PUBLIC_DEBUG: z
      .enum(["true", "false"])
      .default("false")
      .transform((val) => val === "true"),

    // SWR設定（開発環境用）
    NEXT_PUBLIC_SWR_REFRESH_INTERVAL: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive())
      .optional(),

    NEXT_PUBLIC_SWR_DEDUPING_INTERVAL: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive())
      .optional(),
  },

  /*
   * ランタイム環境変数のマッピング
   * destructuring はパフォーマンスのため推奨されない
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    WORDPRESS_GRAPHQL_ENDPOINT: process.env.WORDPRESS_GRAPHQL_ENDPOINT,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_WP_ENDPOINT: process.env.NEXT_PUBLIC_WP_ENDPOINT,
    NEXT_PUBLIC_WP_URL: process.env.NEXT_PUBLIC_WP_URL,
    NEXT_PUBLIC_ALLOWED_IMAGE_HOST: process.env.NEXT_PUBLIC_ALLOWED_IMAGE_HOST,
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION,
    NEXT_PUBLIC_DEBUG: process.env.NEXT_PUBLIC_DEBUG,
    NEXT_PUBLIC_SWR_REFRESH_INTERVAL: process.env.NEXT_PUBLIC_SWR_REFRESH_INTERVAL,
    NEXT_PUBLIC_SWR_DEDUPING_INTERVAL: process.env.NEXT_PUBLIC_SWR_DEDUPING_INTERVAL,
  },

  /*
   * CI/CDでの実行をスキップ
   * ビルド時に環境変数が揃っていない場合に便利
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

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
 * const endpoint = env.NEXT_PUBLIC_WP_ENDPOINT;
 * ```
 */
