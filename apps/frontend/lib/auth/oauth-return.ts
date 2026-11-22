/**
 * Google ログイン (OAuth) の後の戻り先を、cookie で callback に渡す (one-more-time #166)。
 *
 * `redirectTo` にクエリ (`/auth/callback?next=...`) を付けると、Supabase の Redirect URLs の
 * 許可リストに合わない時に Site URL へ戻されてしまう (許可リストはワイルドカードで照合する。
 * https://supabase.com/docs/guides/auth/redirect-urls)。`redirectTo` は `/auth/callback` のまま
 * にし、戻り先は callback だけに送る短い寿命の cookie に入れる。値は callback でもう一度
 * `sanitizeNextPath` を通す (cookie は利用者が書き換えられる)。
 */
export const OAUTH_RETURN_COOKIE = 'oauth_next';
export const OAUTH_RETURN_COOKIE_PATH = '/auth/callback';
/** Google の画面で手間取っても切れない長さ (10 分) */
const MAX_AGE_SECONDS = 600;

/** ブラウザで `document.cookie` に入れる文字列 (Google へ遷移する直前に書く) */
export function oauthReturnCookie(destination: string, secure: boolean): string {
  return [
    `${OAUTH_RETURN_COOKIE}=${encodeURIComponent(destination)}`,
    `Path=${OAUTH_RETURN_COOKIE_PATH}`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    // Google → Supabase → 本サイトの戻りはトップレベルの GET なので Lax で送られる
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** cookie の値 (エンコード済み) を戻り先の候補にする。読めなければ null */
export function readOauthReturn(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
