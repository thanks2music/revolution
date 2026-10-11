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

import { CITY_JOIN, CITY_JOIN_TITLE, formatRoundedCityLabel, parseRoundedCityLabel } from './store-derivation';

/** `in` の後ろの開催地。タイトルの途中 (後ろに半角空白) か末尾にある。 */
const LOCATION_PATTERN = / in (\S+)(?= |$)/;

/** 都市の一覧とみなす区切り。タイトルの `/` に加え、本文の `・` や `、` で書かれることもある。 */
const CITY_LIST_SEPARATOR = new RegExp(`[${CITY_JOIN_TITLE}${CITY_JOIN}、]`);

/**
 * 都市名とみなす語。漢字・かな・長音だけで書かれたもの (店舗名の `Cafe` や日付の `2026` を除く)。
 * 既知の制限: `美術館/展示室` のような漢字の語の並びも都市の一覧とみなす。確定値があるときだけ
 * 動くため、実害は小さいと判断して地名の辞書は持たない。
 */
const CITY_NAME_PATTERN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

/** `in` の後ろが、確定値と同じ形 (都市の一覧か `N都市`) か。 */
function isCityLabelShape(location: string): boolean {
  if (parseRoundedCityLabel(location) !== null) return true;
  const parts = location.split(CITY_LIST_SEPARATOR);
  return parts.length > 1 && parts.every((part) => CITY_NAME_PATTERN.test(part));
}

/** 確定値が表す都市の数。 */
function countCities(cityLabel: string): number {
  return parseRoundedCityLabel(cityLabel) ?? cityLabel.split(CITY_JOIN_TITLE).length;
}

/**
 * タイトルの「カフェ in {都市}」の都市が確定値と食い違う時、確定値に置き換える。
 *
 * - 置き換えるのは都市の部分が確定値と同じ形の時だけ。`in` の後ろが店舗名になる型の
 *   タイトル (`カフェ in OH MY CAFE ...`) や、`in` を使わないタイトルには触れない
 * - 都市の数が合っている `N都市` は、LLM が文字数のために丸めた正しい表記なので残す
 * - 置き換えると `maxLength` を超える場合は `N都市` にする (確定値が 1 都市のときは丸めない)
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

  const cityCount = countCities(cityLabel);
  const roundedLabel = formatRoundedCityLabel(cityCount);
  if (location === roundedLabel) return title;

  // 置換文字列の `$` を特別扱いさせないよう、関数で返す
  const swap = (label: string) => title.replace(` in ${location}`, () => ` in ${label}`);
  const withLabel = swap(cityLabel);
  // 1 都市は「1都市」にすると不自然なので丸めない。丸めても上限を超える場合は、そのまま返して
  // 呼び出し側の文字数の検証 (警告) に任せる
  if (withLabel.length <= maxLength || cityCount === 1) return withLabel;
  return swap(roundedLabel);
}
