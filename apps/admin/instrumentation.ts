/**
 * Next.js の instrumentation hook。
 *
 * サーバ起動時に 1 度だけ呼ばれ、Sentry の設定を読み込む。管理アプリには Edge で動く物が無い
 * (入口の proxy.ts は Next 16 から Node.js で動く) ので、Node 用の設定だけを読む
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

/**
 * App Router の Server Component / Route Handler で throw された例外を Sentry に送る。
 *
 * ⚠️ Server Actions は Result パターン (`{ success: false }` を返す) で throw しないため、
 * ここには一切乗らない。インフラ / DB 起因の失敗は呼び出し箇所で個別に captureException する。
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
