/**
 * LLM の JSON 応答の値をそろえる小さな変換 (Layer 1)。
 *
 * LLM は「値なし」を `null` / `"null"` / 空文字で、真偽値を `true` / `"true"` で、数値を
 * number / 文字列で返すことがある。Vision の応答 (`normalize-vision-response.ts`) と
 * HTML の抽出 (`extraction.service.ts` の lenient の経路) で同じ規則を使う。
 */

export type RawRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 文字列なら trim して返す。空文字や `"null"` は値なし。 */
export function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return undefined;
  return trimmed;
}

/** `true` と `"true"` だけを真とする。 */
export function toBoolean(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

/** number、または「数字とカンマだけの文字列」(`"2,090"`) を数値にする。それ以外は値なし。 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\d[\d,]*$/.test(trimmed)) return undefined;
  return Number(trimmed.replace(/,/g, ''));
}

/** null か空の配列なら true (抽出で「書けなかった」とみなす) */
export const isEmptyList = (list: readonly unknown[] | null | undefined): boolean => !list || list.length === 0;
