/**
 * WEB チェッカーを使えるか。ID トークンのカスタムクレームの `admin` か `allowedEditor` が `true` の人だけ
 * (AI ライターと同じクレーム)。rules も `== true` で比べるので、文字列の "true" や 1 は通さない。
 */
export function canUseWebChecker(claims: Record<string, unknown>): boolean {
  return claims.admin === true || claims.allowedEditor === true;
}
