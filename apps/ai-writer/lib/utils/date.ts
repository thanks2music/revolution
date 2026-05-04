/**
 * Date を Schema-SDD 契約 (ISO 8601 ms) 文字列に正規化する。
 *
 * 入力が空 / Invalid Date / parse 不可能な場合は現在時刻を ISO 8601 ms で返す。
 * これにより `MdxFrontmatterSchema.date` (`datetime({ precision: 3, offset: true })`)
 * の forward-looking 契約に確実に適合させる。
 *
 * @example
 * toIsoMsDate('2025-11-20')           // → "2025-11-20T00:00:00.000Z"
 * toIsoMsDate('Wed, 21 Oct 2015 ...') // → "2015-10-21T07:28:00.000Z"
 * toIsoMsDate(undefined)              // → 現在時刻 (ISO 8601 ms)
 * toIsoMsDate(' ')                    // → 現在時刻 (Invalid Date を回避)
 */
export function toIsoMsDate(input?: string | null): string {
  if (input) {
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}
