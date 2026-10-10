/**
 * @fileoverview 記事タイトルの開催地を、コードが決めた確定値に揃える (Layer 1)
 *
 * タイトル生成の LLM には開催地の確定値 (`都市表記タイトル用`) を渡しているが、
 * `4都市` のように丸めた値を渡すと、都市名を並べ直そうとして**入力に無い都市を作る**
 * ことがある (2026-10-10 heroaca-cafe、gemini-3.6-flash で 3 回中 2 回
 * `東京/大阪/名古屋/宮城`。正しくは 東京・愛知・大阪・北海道)。
 * プロンプトでは確率的にしか防げないため、生成後に機械的に置き換える。
 *
 * 単独の都市名の誤り (`in 大阪` だが確定値は `東京`) は、店舗名の型のタイトルと
 * 見分けるのに地名の辞書が要るため扱わない。
 */

import { CITY_JOIN_TITLE } from './store-derivation';

/** `in` の後ろの開催地。タイトルの途中 (後ろに半角空白) か末尾にある。 */
const LOCATION_PATTERN = / in (\S+)(?= |$)/;

/** 都市の一覧とみなす区切り。タイトルの `/` に加え、本文で使う `・` / `、` で書かれることもある。 */
const CITY_LIST_SEPARATOR = new RegExp(`[${CITY_JOIN_TITLE}・、]`);

const ROUNDED_CITY_LABEL = /^(\d+)都市$/;

/** `in` の後ろが、確定値と同じ形 (都市の一覧か `N都市`) か。 */
function isCityLabelShape(location: string): boolean {
  return CITY_LIST_SEPARATOR.test(location) || ROUNDED_CITY_LABEL.test(location);
}

/** 確定値が表す都市の数。 */
function countCities(cityLabel: string): number {
  const rounded = ROUNDED_CITY_LABEL.exec(cityLabel);
  return rounded ? Number(rounded[1]) : cityLabel.split(CITY_JOIN_TITLE).length;
}

/**
 * タイトルの「カフェ in {都市}」の都市が確定値と食い違う時、確定値に置き換える。
 *
 * - 置き換えるのは都市の部分が確定値と同じ形の時だけ。`in` の後ろが店舗名になる型の
 *   タイトル (`カフェ in OH MY CAFE ...`) や、`in` を使わないタイトルには触れない
 * - 都市の数が合っている `N都市` は、LLM が文字数のために丸めた正しい表記なので残す
 * - 置き換えると `maxLength` を超える場合は `N都市` にする (CI は 40 字を超えると落ちる)
 *
 * @param title - LLM が生成したタイトル
 * @param cityLabel - 確定値 (`東京/大阪` / `4都市`)。無ければ何もしない
 * @param maxLength - タイトルの上限の文字数
 * @returns 置き換え後のタイトル (置き換えが無ければ入力と同一)
 */
export function enforceTitleCityLabel(
  title: string,
  cityLabel: string | undefined,
  maxLength: number,
): string {
  if (!cityLabel) return title;

  const location = LOCATION_PATTERN.exec(title)?.[1];
  if (!location || location === cityLabel || !isCityLabelShape(location)) return title;

  const roundedLabel = `${countCities(cityLabel)}都市`;
  if (location === roundedLabel) return title;

  const withLabel = title.replace(` in ${location}`, ` in ${cityLabel}`);
  return withLabel.length <= maxLength ? withLabel : title.replace(` in ${location}`, ` in ${roundedLabel}`);
}
