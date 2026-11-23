// v11 で '@sentry/nextjs' からの import は使えなくなる (SDK の警告)。公開サイトは別の課題で移す
import { withSentryConfig } from '@sentry/nextjs/config';

/**
 * 管理アプリ (one-more-time #167、ADR-0006)。BOSS が確認待ちの口コミを処理する。公開サイトとは別の
 * Vercel プロジェクトで、同じ Supabase を使う。
 *
 * 口コミの操作の層は shared/reviews (@revolution/reviews)。写真の変換 (sharp・heic-decode) は呼ばないが、
 * 同じパッケージを読み込むので、公開サイトと同じくバンドルの外に置く
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  transpilePackages: ['@revolution/reviews', '@revolution/schemas', '@revolution/slack'],
  serverExternalPackages: ['heic-decode', 'libheif-js'],

  // 審査のプロンプト (scripts/fetch-templates.sh がビルドの最初に取り込む) を、もう一度 AI にかける
  // Server Action のある口コミの確認のページの関数に含める。実行時に fs で読むので、静的な解析では含まれない
  outputFileTracingIncludes: {
    '/reviews/[id]': ['./templates/reviews/**'],
  },

  poweredByHeader: false,

  async headers() {
    // 公開サイト (apps/frontend/next.config.mjs) と同じく、接続先は env から作る。headers() は build の時に
    // 評価されるので、NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SENTRY_DSN は Vercel の build でも読める必要がある
    const origins = [];
    for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SENTRY_DSN]) {
      if (!value) continue;
      try {
        origins.push(new URL(value).origin);
      } catch {
        // 不正な URL は省く (ヘッダの生成は続ける)
      }
    }
    const connectSrc = ["'self'", ...origins].join(' ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // 写真は保管側の短時間だけ有効な URL (R2) から読む
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src ${connectSrc}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 管理の画面の URL を、写真の配信元などへ送らない
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // 検索に載せない (vercel.json と二段)
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: 'we-are-all-one',
  project: 'revolution-admin',
  // 認証は env 経由のみ。未設定ならアップロードは skip され build は通る
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  silent: !process.env.CI,
});
