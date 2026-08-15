/**
 * @fileoverview Inertia.js の `data-page` ペイロードからマークアップを復元する (Layer 1)
 *
 * @description
 * Inertia.js (+ Svelte 等) を使うサイトは、**ページ本文を DOM ではなく root 要素の
 * `data-page` 属性に JSON として埋め込み**、クライアント側で hydrate する。
 * 生 HTML を fetch するだけのパイプラインからは本文が「存在しない」ように見える。
 *
 * ## 実測 (2026-08-15、LTR 系 8 サイト)
 *
 * | サイト | `data-page` | 生 HTML の本文テキスト | 実走結果 |
 * |---|---|---|---|
 * | bluelockcafe2026 / kusuriya-cafe / sw2026 / monokuro-2026 / hunny2026 / toy5 | なし | 973〜1,985 字 | 正常 |
 * | **miku-wa-modern-cafe** | **あり** | **19 字** | 会場・日程を全て取りこぼし、企画名を店舗名として記事化 |
 * | **nissy-cafe-2026** | **あり** | **38 字** | 同上 |
 *
 * `data-page` の有無と記事の破綻が 1:1 で一致していた。復元すると
 * miku は `.place` 3 ブロック、nissy は 7 ブロックが正しく取り出せる。
 *
 * ## なぜ headless レンダリングではないのか
 *
 * ブラウザを起動しなくても JSON をパースするだけで済み、決定的で速い。
 * 実際 Playwright で描画しても innerText は 143 字しか取れなかった
 * (hydrate 前に評価される / 一部が遅延描画される) ため、**むしろこちらの方が確実**。
 */

import * as cheerio from 'cheerio';

/** HTML タグらしき文字列を含むか。CSS や純テキストを除外するのに使う。 */
const HTML_TAG_PATTERN = /<[a-z][^>]*>/i;

/** 復元したマークアップを包むコンテナ。既存セレクタと衝突しない名前にする。 */
const CONTAINER_CLASS = 'inertia-recovered-payload';

/**
 * `data-page` の JSON を取り出してパースする。
 *
 * cheerio が属性値の HTML エンティティを復号するため、手書きのデコーダは要らない。
 *
 * @returns パース済みオブジェクト。属性が無い / JSON として壊れている場合は null
 */
function parseDataPage(html: string): unknown | null {
  let raw: string | undefined;
  try {
    raw = cheerio.load(html)('[data-page]').first().attr('data-page');
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // Inertia 以外が同名属性を使っている場合など。復元を諦めるだけで害はない。
    return null;
  }
}

/** オブジェクトを再帰的に辿り、文字列の葉をすべて列挙する。 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/**
 * `data-page` ペイロードから HTML マークアップを復元する。
 *
 * JSON の文字列値のうち **HTML タグを含むものだけ**を拾う。これにより
 * `content.css` (実測 23,740 字) のようなスタイル文字列や、単なるラベル文字列を
 * 自然に除外できる。
 *
 * @param html - fetch した生 HTML
 * @returns 復元したマークアップ。Inertia でない / 中身が無い場合は null
 */
export function extractInertiaMarkup(html: string): string | null {
  const data = parseDataPage(html);
  if (data === null) return null;

  const strings: string[] = [];
  collectStrings(data, strings);

  const markup = strings.filter((s) => HTML_TAG_PATTERN.test(s));
  if (markup.length === 0) return null;

  // 同一文字列が props の複数箇所に現れることがあるため重複を除く
  return [...new Set(markup)].join('\n');
}

/**
 * Inertia ペイロードを持つ HTML に、復元したマークアップを**追記**して返す。
 *
 * 置換ではなく追記にするのは、SSR と Inertia を併用するサイトで
 * 元の DOM 側にある情報を失わないため。Inertia でなければ入力をそのまま返す。
 *
 * @param html - fetch した生 HTML
 * @returns 復元済みマークアップを追記した HTML (非 Inertia なら入力と同一)
 */
export function expandInertiaPayload(html: string): string {
  const markup = extractInertiaMarkup(html);
  if (!markup) return html;

  return `${html}\n<div class="${CONTAINER_CLASS}">\n${markup}\n</div>`;
}
