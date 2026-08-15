/**
 * Sentry 初期化 (ブラウザ)。
 *
 * Next.js がクライアントバンドルのエントリで自動的に読み込む。
 * DSN は `NEXT_PUBLIC_` prefix が必須 (それ以外はバンドルに inline されない)。
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Session Replay は入れない (無料枠 50/月 で監視目的に足りず、worker-src の CSP 追加も要るため)
  tracesSampleRate: 0.1,

  sendDefaultPii: false,

  // frontend と揃える。管理 UI は低トラフィックだが、除外条件を片方だけ持つと
  // 「なぜ差があるのか」が後から分からなくなる。
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
  ],
});

/**
 * App Router のクライアント遷移を trace に載せる。
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
