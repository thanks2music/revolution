/**
 * 文字列を正規表現の中でそのまま一致させるために、正規表現の特殊文字をエスケープする。
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
