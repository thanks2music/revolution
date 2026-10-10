/**
 * @fileoverview 記事タイトルの開催地を、コードが決めた確定値に揃える (Layer 1)
 *
 * タイトル生成の LLM には開催地の確定値 (`都市表記タイトル用`) を渡しているが、
 * `4都市` のように丸めた値を渡すと、都市名を並べ直そうとして**入力に無い都市を作る**
 * ことがある (2026-10-10 heroaca-cafe、gemini-3.6-flash で 3 回中 2 回
 * `東京/大阪/名古屋/宮城`。正しくは 東京・愛知・大阪・北海道)。
 * プロンプトでは確率的にしか防げないため、生成後に機械的に置き換える。
 */

import { CITY_JOIN_TITLE } from './store-derivation';

/** `in` の後ろが、確定値と同じ形 (`/` 区切りの都市一覧か `N都市`) か。 */
function isCityLabelShape(location: string): boolean {
  return location.includes(CITY_JOIN_TITLE) || /^\d+都市$/.test(location);
}

/**
 * タイトルの「カフェ in {都市}」の都市が確定値と食い違う時、確定値に置き換える。
 *
 * 置き換えるのは都市の部分が確定値と同じ形の時だけ。`in` の後ろが店舗名になる型の
 * タイトル (`カフェ in OH MY CAFE ...`) や、`in` を使わないタイトルには触れない。
 *
 * @param title - LLM が生成したタイトル
 * @param cityLabel - 確定値 (`東京/大阪` / `4都市`)。無ければ何もしない
 * @returns 置き換え後のタイトル (置き換えが無ければ入力と同一)
 */
export function enforceTitleCityLabel(title: string, cityLabel: string | undefined): string {
  if (!cityLabel) return title;

  return title.replace(/ in (\S+) /, (match, location: string) =>
    location !== cityLabel && isCityLabelShape(location) ? ` in ${cityLabel} ` : match
  );
}
