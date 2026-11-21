/**
 * 一時的なエラーだけをやり直す (仕様: 429・5xx・タイムアウトは、間隔を空けて 2 回まで)。
 *
 * 形の崩れた応答・ブロック・打ち切りなど、やり直しても結果が変わらない失敗はやり直さない。
 */

/** やり直しの間隔 (ミリ秒)。要素の数がやり直しの回数 */
const RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** エラーの種類。やり直すかどうか (`isTransientError`) と、失敗の記録の文の両方がこれを使う */
export type ErrorKind =
  | { kind: 'http'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'other'; name: string | null };

export function classifyError(error: unknown): ErrorKind {
  if (typeof error !== 'object' || error === null) return { kind: 'other', name: null };
  const { status, name, message, cause } = error as Record<string, unknown>;
  if (typeof status === 'number') return { kind: 'http', status };
  // `AbortSignal.timeout` の中断。DOMException は realm をまたぐと instanceof が効かないので name で見る
  if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout' };
  // fetch の通信の失敗 (undici は TypeError: fetch failed を投げ、原因を cause に付ける)。
  // ほかの TypeError はプログラムの不具合として扱う
  if (name === 'TypeError' && (message === 'fetch failed' || cause !== undefined))
    return { kind: 'network' };
  return { kind: 'other', name: typeof name === 'string' ? name : null };
}

/** 一時的なエラーか (429・5xx・タイムアウト・通信の失敗) */
export function isTransientError(error: unknown): boolean {
  const classified = classifyError(error);
  switch (classified.kind) {
    case 'http':
      return classified.status === 429 || classified.status >= 500;
    case 'timeout':
    case 'network':
      return true;
    case 'other':
      return false;
  }
}

/** fn を呼び、一時的なエラーなら間隔を空けてやり直す。最後の失敗はそのまま投げる */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delays.length || !isTransientError(error)) throw error;
      await sleep(delays[attempt]);
    }
  }
}
