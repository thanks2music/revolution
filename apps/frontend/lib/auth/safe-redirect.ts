/**
 * open-redirect サニタイザ (Layer1 純粋関数) — Crescendolls 会員機能
 *
 * `?next=` のような return-to パラメータは、攻撃者が外部 URL を仕込むと
 * open-redirect (フィッシング) になる。安全な「同一オリジンの内部パス」だけを
 * 通し、それ以外は安全な既定パス (`/mypage`) にフォールバックする共有関数。
 *
 * 旧来の各ファイル個別ガード `/^\/(?!\/)/` は以下を取りこぼしていた:
 *   - `/\evil.com`     : ブラウザは `\` を `/` に正規化し `//evil.com` (protocol-relative)
 *                        として外部に飛びうる。`(?!\/)` は `\` を弾かない。
 *   - `/%5Cevil.com`   : `%5C` = `\`。decode 前の生文字列では検知できない。
 *   - `/%2F%2Fevil.com`: `%2F%2F` = `//`。decode 後に protocol-relative になる。
 *
 * 本サニタイザは「decode → 正規化 → 構造判定 → URL 解決で同一オリジン確認」の
 * 多段防御で、これらを確実に `/mypage` に倒す。3 ファイル (auth/callback, login/page,
 * LoginForm) が同一ロジックを共有し、ドリフト (片方だけ脆弱) を防ぐ。
 */

/** フォールバック先 (サニタイズ失敗時に必ずここへ倒す)。 */
export const DEFAULT_SAFE_PATH = '/mypage';

/** 同一オリジン解決の基準 origin (任意のローカル値で良い。pathname 抽出にのみ使う)。 */
const BASE_ORIGIN = 'http://localhost';

/** 制御文字 (\x00-\x1f / \x7f、CR/LF/TAB を含む)。改行等での回避を排除する。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 内部パスとして安全に「見える」形かを構造判定する。
 *   - 先頭が単一 `/` (2 文字目が `/` でも `\` でもない) であること。
 *     → protocol-relative (`//host`) と backslash-relative (`/\host`) を排除。
 *   - 制御文字 (CR/LF/TAB 等) を含まないこと。
 *   - `\` を含まないこと (バックスラッシュは `/` に正規化されうるため一切許さない)。
 *   - 連続 `//` をパス中のどこにも含まないこと (decode 後の `//host` 混入を排除)。
 */
function looksLikeSafeInternalPath(value: string): boolean {
  if (!/^\/(?![/\\])/.test(value)) return false;
  if (CONTROL_CHARS.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.includes('//')) return false;
  return true;
}

/**
 * `?next=` 等の生の値を「同一オリジンの安全な内部パス」に正規化する。
 * 安全と確認できない場合は `DEFAULT_SAFE_PATH` (`/mypage`) を返す。
 *
 * @param raw URL から取り出した生の next 値 (未 decode / null 可)
 * @returns 安全な内部パス (`/...`)。常に同一オリジン相対で外部に飛ばない。
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_SAFE_PATH;

  // 1. 二重エンコード対策: 1 回 decode を試み、decode 後の値でも判定する。
  //    decode に失敗する不正な %シーケンスは拒否 (攻撃の可能性)。
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_SAFE_PATH;
  }

  // 2. 生値と decode 後の双方が安全な内部パス形であることを要求する
  //    (decode 前は安全に見えても decode で `//` / `\` が現れるケースを排除)。
  if (!looksLikeSafeInternalPath(raw)) return DEFAULT_SAFE_PATH;
  if (!looksLikeSafeInternalPath(decoded)) return DEFAULT_SAFE_PATH;

  // 3. WHATWG URL で解決し、pathname が同一オリジン相対に留まることを確認する。
  //    base に対して resolve した結果の origin が base と一致しなければ外部遷移。
  try {
    const resolved = new URL(decoded, BASE_ORIGIN);
    if (resolved.origin !== BASE_ORIGIN) return DEFAULT_SAFE_PATH;
    // 念のため最終形も構造判定 (resolve 過程での `//` 等の混入を再確認)。
    if (!looksLikeSafeInternalPath(resolved.pathname)) return DEFAULT_SAFE_PATH;
    // 返すのは生値 (エンコードのまま) を resolve した形。判定は decode 後で済んでいる。
    // decode 後の形を返すと、クエリの `%` `&` などが崩れ、もう一度サニタイズした時に decode に失敗する
    // (onboarding を挟む戻り先は、middleware・ページ・フォームで複数回通る。one-more-time #166)
    const original = new URL(raw, BASE_ORIGIN);
    if (original.origin !== BASE_ORIGIN) return DEFAULT_SAFE_PATH;
    if (!looksLikeSafeInternalPath(original.pathname)) return DEFAULT_SAFE_PATH;
    return `${original.pathname}${original.search}${original.hash}`;
  } catch {
    return DEFAULT_SAFE_PATH;
  }
}
