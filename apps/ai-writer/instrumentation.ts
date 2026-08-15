/**
 * Next.js の instrumentation hook。
 *
 * サーバ起動時に 1 度だけ呼ばれ、ランタイムに応じた Sentry 設定を読み込む。
 * 動的 import にしているのは、Edge バンドルに Node 用の設定を巻き込まないため (公式手順)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * App Router の Server Component / Route Handler で throw された例外を Sentry に送る。
 *
 * ⚠️ Server Actions の Result パターン (throw せず `{ success: false }` を返す) は
 * ここに一切乗らない。個別に captureException する必要がある。
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
