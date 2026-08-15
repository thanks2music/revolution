/**
 * Sentry 初期化 (ブラウザ)。
 *
 * DSN は `NEXT_PUBLIC_` prefix が必須 (それ以外はバンドルに inline されない)。
 * ⚠️ ここで使う DSN が CSP の `connect-src` に載る値と一致していないと、
 * イベントはブラウザ側でブロックされる (next.config.mjs の headers() を参照)。
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Session Replay は入れない (無料枠 50/月 では監視に足りず、worker-src の CSP 追加も要るため)
  tracesSampleRate: 0.1,

  sendDefaultPii: false,

  // ブラウザ拡張由来のノイズで無料枠 (5K events/月) を溶かさない
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
  ],
});

/**
 * App Router のクライアント遷移を trace に載せる。
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
