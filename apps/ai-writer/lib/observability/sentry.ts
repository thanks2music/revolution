/**
 * Sentry の薄いユーティリティ層。
 *
 * ここに置くのは「Sentry SDK の設定ファイルからも、業務コードからも使いたい」ものだけ。
 * 汎用ロガーやラッパー API をここに増やさないこと (YAGNI)。
 */
import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

import { DuplicateSlugError, GitHubError } from '@/lib/errors/github';

/**
 * Cloud Run 上でイベントを取りこぼさないための明示 flush。
 *
 * @description
 * Cloud Run は `--min-instances 0` かつ **レスポンス送出後に CPU が throttle される**ため、
 * 「レスポンスを返してから背後で送信する」型の非同期処理は完走しない。
 * SDK v10 の `flushIfServerless` は Cloud Run を検出して App Router の route handler を
 * 自動 flush するが、**handler が return した後に走る処理は救えない**
 * (例: `ReadableStream` の `start()` 内で進むパイプライン)。
 *
 * そのため「レスポンスを返す前」に本関数を await する必要がある。
 *
 * 送信に失敗しても業務処理は落とさない (監視のために本番が止まるのは本末転倒)。
 *
 * @param timeoutMs - 最大待機時間。既定 2000ms は Cloud Run の `--timeout 300` に対して
 *   無視できる長さで、かつ ingest への 1 往復には十分。
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // flush 自体の失敗は握りつぶす (監視の失敗で業務を止めない)
  }
}

/**
 * Sentry に送る前にイベントを選別する。
 *
 * @description
 * `sentry.server.config.ts` の `beforeSend` に渡す純粋関数。
 * **設定ファイル側ではなくここに置いているのは、`Sentry.init()` の副作用なしに
 * 単体テストできるようにするため。**
 *
 * 判定は 2 つだけ:
 * - `DuplicateSlugError` は **drop** する。同一記事の再投入で日常的に起きる想定内の事象で、
 *   呼び出し側は 409 を返して正常に処理している。Issue にすると無料枠 (5K events/月) を食う
 * - `retryable` な GitHub エラーは `warning` へ降格する。リトライで回復する見込みがあり、
 *   「誰かが起きて対応すべき」ものではない。Sentry の priority は log level で決まるため、
 *   warning に落とすことでメール通知の対象から外れる
 */
export function beforeSendFilter(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  const error = hint?.originalException;

  if (error instanceof DuplicateSlugError) {
    return null;
  }

  if (error instanceof GitHubError && error.retryable) {
    return { ...event, level: 'warning' };
  }

  return event;
}
