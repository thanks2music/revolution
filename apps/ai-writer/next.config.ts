import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Next.js 公式推奨: shared/schemas/ workspace の .ts ファイルを直接 transpile する
  transpilePackages: ['@revolution/schemas'],

  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  images: {
    // v16 で変更されたデフォルト値を明示的に設定（現行動作を維持）
    minimumCacheTTL: 60, // Override Next.js 16 default (4 hours) to 60s for faster content updates
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384], // v16 でデフォルトから 16 が削除されたため明示
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    remotePatterns: [
      // Cloudflare R2 (production image hosting)
      {
        protocol: 'https',
        hostname: 'images.anime-events.com',
      },
    ],
  },
};

// Validate required Firebase environment variables at build time
// Skip validation in CI environment (dummy values are used for build-only testing)
const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  // Sentry の DSN が build-arg で渡っていない production build は明示的に落とす。
  // DSN 未設定でも SDK は例外を出さず **無言で no-op** になるため、
  // 「導入したつもりで一切イベントが飛ばない」が最悪のシナリオになる。
  'NEXT_PUBLIC_SENTRY_DSN',
];

if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') {
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Firebase environment variables for production build: ${missing.join(', ')}. ` +
        `Please set these in your deployment environment.`
    );
  }
}

export default withSentryConfig(nextConfig, {
  org: 'we-are-all-one',
  project: 'revolution-ai-writer',

  // SENTRY_ORG / SENTRY_PROJECT は秘密ではないためリテラル直書きにし、env 経路を減らす。
  // 認証だけは env (SENTRY_AUTH_TOKEN) 経由。未設定ならアップロードは skip され build は通る。
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Docker の builder stage には `.git` が無い (COPY 対象外) ため、plugin による
  // git からの release 自動検出は必ず失敗する。CI では build-arg で github.sha を渡す。
  // 未設定時は undefined に委ね、ローカルの `pnpm docker:build` を壊さない。
  release: { name: process.env.SENTRY_RELEASE },

  // アップロード済みの source map をビルド成果物から削除する。
  // v10 時点の既定値も true だが、将来の既定変更で `.map` が公開されるのを防ぐため明示する。
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // 通常のビルドログを汚さない。アップロードを確認したい時だけ CI=true で実行する。
  silent: !process.env.CI,

  disableLogger: true,
});