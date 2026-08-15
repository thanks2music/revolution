/**
 * Sentry 初期化 (Edge ランタイム)。
 *
 * `middleware.ts` が Edge で動くため必須。
 * Edge は Node API が使えないため、`beforeSend` (lib/errors への依存を持つ) は入れない。
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  tracesSampleRate: 0.1,

  sendDefaultPii: false,
});
