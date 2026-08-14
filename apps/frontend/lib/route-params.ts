/**
 * URL セグメントの正準化 (Layer 1、純粋関数)。
 *
 * ## なぜ `Number()` を使わないのか
 *
 * `Number()` は数値リテラルの表記ゆれを**すべて同じ値に潰す**。実測 (2026-08-14):
 *
 * | 入力 | `Number()` | `Number.isInteger` |
 * |---|---|---|
 * | `"2"` | 2 | ✅ |
 * | `"2.0"` / `"2e0"` / `"0x2"` / `"+2"` / `"02"` / `"2."` / `" 2 "` | 2 | ✅ **全部通る** |
 *
 * つまり `/events/2` と `/events/2.0` と `/events/0x2` が**同一コンテンツを 200 で返す**。
 * canonical タグも出していないので、検索エンジンから見れば重複コンテンツが
 * 無限に作れる状態になる。SEO が主要な流入経路である本サイトでは看過できない。
 *
 * ID は URL の一部であり、**正準形は 1 つだけ**であるべき。正準形以外は 404 にする。
 */

/** 正準形の正整数のみ (先頭ゼロ・符号・小数点・指数・16 進を許さない)。 */
const CANONICAL_POSITIVE_INT = /^[1-9][0-9]*$/;

/**
 * URL セグメントを正整数 ID として解釈する。正準形でなければ null。
 *
 * null が返った呼び出し元は **DB へ問い合わせず 404 に倒す**こと。
 */
export function parseCanonicalId(raw: string): number | null {
  if (!CANONICAL_POSITIVE_INT.test(raw)) return null;
  const value = Number(raw);
  // 正規表現を通っていても桁数が多すぎると精度が落ちる (Number.MAX_SAFE_INTEGER 超)。
  // bigint 主キーなので理屈上は到達しうるため、安全側に倒す。
  return Number.isSafeInteger(value) ? value : null;
}
