/**
 * Sentry 初期化 (Edge ランタイム)。
 *
 * `middleware.ts` の matcher が広く、ほぼ全リクエストが Edge を通るため必須。
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  // 空文字でもフォールバックさせる (`??` だと no-op になる)。server config と同方針。
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  tracesSampleRate: 0.1,

  sendDefaultPii: false,
});
