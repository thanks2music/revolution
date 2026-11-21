/**
 * 一時的なエラーだけをやり直す (仕様: 429・5xx・タイムアウトは、間隔を空けて 2 回まで)。
 *
 * 形の崩れた応答・ブロック・打ち切りなど、やり直しても結果が変わらない失敗はやり直さない。
 */

/** やり直しの間隔 (ミリ秒)。要素の数がやり直しの回数 */
export const RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** 一時的なエラーか (429・5xx・タイムアウト・通信の失敗) */
export function isTransientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, name } = error as { status?: unknown; name?: unknown };
  if (typeof status === 'number') return status === 429 || status >= 500;
  // `AbortSignal.timeout` の中断。DOMException は realm をまたぐと instanceof が効かないので name で見る
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  // fetch の通信の失敗 (undici は TypeError: fetch failed を投げ、原因を cause に付ける)。
  // ほかの TypeError はプログラムの不具合なので、やり直さない
  if (name === 'TypeError') {
    const { message, cause } = error as { message?: unknown; cause?: unknown };
    return message === 'fetch failed' || cause !== undefined;
  }
  return false;
}

/** fn を呼び、一時的なエラーなら間隔を空けてやり直す。最後の失敗はそのまま投げる */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delays.length || !isTransientError(error)) throw error;
      await sleep(delays[attempt]);
    }
  }
}
