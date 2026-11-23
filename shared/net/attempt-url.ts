/**
 * 同じページを 2 度試さないための、URL の比べ方。全アプリで共有する (AI ライターの定期実行と WEB チェッカー)。
 *
 * 同じページが別の URL で届くことがある: Google アラートのリダイレクトや、計測のパラメータが付いた同じリンク。
 * そのまま比べると、同じページを 2 度試し、AI の費用をまた払う。決まり (2026-11-15):
 *
 * - Google のリダイレクトの URL は、指している先のページに戻す
 * - 計測のパラメータ (`utm_*` と下のクリック ID) と `#` 以降を落とす
 * - それ以外 (末尾の `/`・ほかのパラメータ・スキーム・`www`) はそのまま。変えると別のページを返すサイトがあり、
 *   同じページと見なすと、まだ試していないページを飛ばしうる
 *
 * 外部の依存を持たない (Node の標準モジュールだけ)。
 *
 * @module @revolution/net/attempt-url
 */
import { createHash } from 'node:crypto';

/** 訪問を数えるだけのクリック ID (`utm_*` は前方一致で別に落とす) */
const CLICK_ID_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'msclkid', 'mc_cid', 'mc_eid']);

/** Google のリダイレクトのホスト。`notgoogle.com` などを Google と見なさないよう、完全一致で比べる */
const GOOGLE_REDIRECT_HOSTS = new Set(['google.com', 'www.google.com']);

/**
 * Google のリダイレクトの URL (`https://www.google.com/url?...&url=<先>`) なら、指している先を返す。
 * 外のページから拾ったリンクにも使うので、ホスト名とパス (`/url`) で判定する (文字列を含むだけでは戻さない)
 */
export function unwrapGoogleRedirect(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!GOOGLE_REDIRECT_HOSTS.has(parsed.hostname) || parsed.pathname !== '/url') return url;
  return parsed.searchParams.get('url') ?? url;
}

/**
 * 比べる時と、試した記録に残す時に使う URL。URL として読めない文字列は、前後の空白を落とすだけで返す。
 */
export function normalizeAttemptUrl(rawUrl: string): string {
  const unwrapped = unwrapGoogleRedirect(rawUrl.trim());
  let url: URL;
  try {
    url = new URL(unwrapped);
  } catch {
    return unwrapped;
  }

  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (lower.startsWith('utm_') || CLICK_ID_PARAMS.has(lower)) url.searchParams.delete(name);
  }
  // すべて落とすと `URL` は `?` だけを残すので、消す
  if (url.searchParams.size === 0) url.search = '';
  return url.toString();
}

/**
 * 正規化した URL の Firestore のドキュメント ID。URL はそのままでは ID にできない (`/` を含む) ので、SHA-256 にする。
 * AI ライターの「試した URL」・登録 URL と、WEB チェッカーの検知リンクで同じ ID になる。
 */
export function attemptDocId(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}
