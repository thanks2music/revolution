/**
 * Sentry 初期化 (Node.js ランタイム)。
 *
 * `instrumentation.ts` の `register()` から `NEXT_RUNTIME === 'nodejs'` の時だけ動的 import される。
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  // frontend は Vercel でビルド・実行されるため NEXT_PUBLIC_ の 1 本で足りるが、
  // ai-writer と経路を揃え、将来 prefix なしで注入したくなった場合にも対応できるようにする。
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  tracesSampleRate: 0.1,

  sendDefaultPii: false,
});
