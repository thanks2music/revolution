/**
 * 本文の節に、抽出結果をコードで差し込む (2026-10-12)
 *
 * 本文の LLM に品名やノベルティ名を書き写させると、誤字が混ざる (コナンで「招待状（ランダム7种）」と
 * 中国語の字を書いた)。そこで、名前の入る部分はコードが抽出結果から組み立て、LLM が書いたものと置き換える。
 * LLM が書くのは導入文などの地の文だけになる。
 *
 * - メニューの節: LLM が書いた品目の見出し (`### …`) を消し、`sections/02-menu.yaml` の `rendered.item_line` で全品を並べる。
 *   品目ごとの画像 (代替テキストと品名で照合したもの) があれば、見出しの直後に並べる (2026-10-13)
 * - ノベルティの節: 見出しの直後の段落を、`sections/03-novelty.yaml` の `rendered.sentence` で置き換える
 * - グッズの節の一覧は `goods-list.ts` (同じ部品を使う)
 *
 * 文面と書式は Templates の YAML が SoT。ここは差し込むだけを行う。差し込む値は外部のページから読んだものなので、
 * MDX の式・JSX として評価されないようにする (`escapeMdxText`)。
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import { escapeMdxText } from '@/lib/utils/mdx-safety';

export type TemplateValues = Record<string, string | string[] | null | undefined>;

/**
 * 書式に値を差し込む。扱うのは `{{x}}`・`{{x|join:'区切り'}}`・`{{#if x}}...{{/if}}` だけ
 * (値が空なら if の中身を落とす)。値はそのまま入れるので、呼び出し側でエスケープしておく。
 */
export function fillTemplate(template: string, values: TemplateValues): string {
  const isEmpty = (value: TemplateValues[string]) =>
    value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  return template
    .replace(/\{\{#if ([^{}|\s]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key: string, body: string) =>
      isEmpty(values[key]) ? '' : body
    )
    .replace(/\{\{([^{}|\s]+)\|join:'([^']*)'\}\}/g, (_, key: string, separator: string) => {
      const value = values[key];
      return Array.isArray(value) ? value.join(separator) : (value ?? '');
    })
    .replace(/\{\{([^{}|#/\s]+)\}\}/g, (_, key: string) => {
      const value = values[key];
      return Array.isArray(value) ? value.join('、') : (value ?? '');
    });
}

/** 節 (`## …`) の本文の範囲。`start` は見出しの行の直後、`end` は次の `## ` の手前 (無ければ末尾) */
export interface SectionRange {
  start: number;
  end: number;
}

export function findSection(content: string, heading: RegExp): SectionRange | null {
  const match = heading.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const next = content.slice(start).search(/^## /m);
  return { start, end: next === -1 ? content.length : start + next };
}

/** 節の本文を差し替える */
function replaceSectionBody(content: string, range: SectionRange, body: string): string {
  return content.slice(0, range.start) + body + content.slice(range.end);
}

const yamlCache = new Map<string, Record<string, unknown>>();

/**
 * `templates/collabo-cafe/sections/<file>` の `key` を読む (ファイルごとにキャッシュ)。
 *
 * @throws ファイルや `key` が無いとき (`pnpm sync:templates` が要る)
 */
export function loadSectionYaml<T>(file: string, key: string, dir = defaultSectionsDir()): T {
  const yamlPath = path.join(dir, file);
  let parsed = yamlCache.get(yamlPath);
  if (!parsed) {
    parsed = (yaml.load(fs.readFileSync(yamlPath, 'utf-8')) ?? {}) as Record<string, unknown>;
    yamlCache.set(yamlPath, parsed);
  }
  const value = parsed[key];
  if (value === undefined) {
    throw new Error(`${yamlPath} に ${key} がありません。pnpm sync:templates で Templates を同期してください`);
  }
  return value as T;
}

/**
 * `<file>` の `rendered` を読み、`keys` がすべてあることを確かめる (Templates が古いと、undefined が本文に
 * 「undefined」と書かれたり、書式の関数が TypeError を投げたりするため、ここでまとめて止める)
 *
 * @throws ファイル・`rendered`・キーが無いとき (`pnpm sync:templates` が要る)
 */
export function loadRendered<T extends object>(file: string, keys: readonly (keyof T & string)[], dir?: string): T {
  return loadChecked<T>(file, 'rendered', keys, dir);
}

/** `<file>` の `key` を読み、その中に `keys` がすべてあることを確かめる (`loadRendered` と同じ理由) */
export function loadChecked<T extends object>(file: string, key: string, keys: readonly (keyof T & string)[], dir?: string): T {
  const value = loadSectionYaml<T>(file, key, dir);
  const missing = keys.filter((name) => (value as Record<string, unknown>)[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`${file} の ${key} に ${missing.join(' / ')} がありません。pnpm sync:templates で Templates を同期してください`);
  }
  return value;
}

function defaultSectionsDir(): string {
  return path.join(process.cwd(), 'templates', 'collabo-cafe', 'sections');
}

/**
 * メニューの品目の見出しを組み立てる (品名・価格・キャラクターはエスケープして差し込む)。
 * `itemImages[i]` があれば (書き出し済みの画像の MDX)、i 番目の品目の見出しの直後に続ける
 */
export function renderMenuItems(items: ExtractionMenuItem[], itemLine: string, itemImages: string[] = []): string[] {
  return items.map((item, index) => {
    const heading = fillTemplate(itemLine, {
      character: item.character ? escapeMdxText(item.character) : null,
      name: escapeMdxText(item.name),
      price: item.price ? escapeMdxText(item.price) : null,
    });
    return withItemImage(heading, itemImages[index]);
  });
}

/** メニューの節の見出し (記事の更新の減少チェック `lib/mdx/article-counts.ts` も使う) */
export const MENU_SECTION = /^## .*メニュー[ \t]*$/m;
/** ノベルティの節の見出し (同上) */
export const NOVELTY_SECTION = /^## .*ノベルティー?[ \t]*$/m;

/**
 * 画像の欄の行 (Markdown の画像・画像のプレースホルダー・`<ArticleImage>`)。名前を差し込むとき、
 * この行を LLM の地の文や品目と取り違えると画像が消える
 */
const IMAGE_LINE = /^(?:!\[|\{ここに|<ArticleImage)/;

/** メニューの節があるか (品目ごとの画像は、節が無いと差し込めない) */
export function hasMenuSection(content: string): boolean {
  return findSection(content, MENU_SECTION) !== null;
}

/** ノベルティの節があるか */
export function hasNoveltySection(content: string): boolean {
  return findSection(content, NOVELTY_SECTION) !== null;
}

/**
 * 節 (`heading` に当たる `## …`) の末尾に、空行を挟んで `block` を差し込む。次の節が続くなら block の後にも空行を入れる
 * (MDX で、表などの直後の見出しが前のブロックの一部と読まれないように)。節が無い、または block が空ならそのまま
 */
export function appendToSection(content: string, heading: RegExp, block: string): string {
  const range = findSection(content, heading);
  if (!range || !block) return content;
  const before = content.slice(range.start, range.end).replace(/\s+$/, '');
  const tail = range.end < content.length ? '\n\n' : '\n';
  return replaceSectionBody(content, range, `${before}\n\n${block}${tail}`);
}

/** メニューの節の末尾に差し込む */
export function appendToMenuSection(content: string, block: string): string {
  return appendToSection(content, MENU_SECTION, block);
}

/** ノベルティの節の末尾に差し込む (導入の文の下に並べるノベルティ名の見出しと画像。2026-10-15) */
export function appendToNoveltySection(content: string, block: string): string {
  return appendToSection(content, NOVELTY_SECTION, block);
}

/** 見出しの直後に、その品目の画像 (書き出し済みの MDX) を続ける */
function withItemImage(heading: string, image: string | undefined): string {
  return image ? `${heading}\n\n${image}` : heading;
}

/**
 * 品名だけの見出し (`line` に name を差し込んだもの) を並べ、`itemImages[i]` があれば i 番目の見出しの直後に続ける
 * (ノベルティ)
 */
export function renderItemHeadings(names: readonly string[], line: string, itemImages: readonly string[] = []): string[] {
  return names.map((name, index) => withItemImage(fillTemplate(line, { name: escapeMdxText(name) }), itemImages[index]));
}

/** `placeholder` を含む行を `replacement` に置き換える (空なら行ごと消し、続く空行を詰める) */
export function replacePlaceholderLine(content: string, placeholder: string, replacement: string): string {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.includes(placeholder));
  if (index === -1) return content;
  lines.splice(index, 1, ...(replacement ? [replacement] : []));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 照合できなかった画像を、見出しを付けて並べるブロック (画像が無ければ空) */
export function otherImagesBlock(heading: string, images: string): string {
  return images ? `${heading}\n\n${images}` : '';
}

/** Markdown の表のセルを壊さないよう、区切りの | を全角にする */
export function tableCell(value: string): string {
  return value.replace(/\|/g, '｜');
}

/**
 * メニューの節の、LLM が書いた品目の範囲 (最初の `### ` の行から、最初の画像の欄 (画像・プレースホルダー) の手前まで)。
 * LLM が品目を書いていなければ、最初の画像の欄の手前 (無ければ節の末尾) の空の範囲
 */
function llmItemRange(lines: string[]): { from: number; to: number } {
  const isImage = (line: string) => IMAGE_LINE.test(line);
  const firstItem = lines.findIndex((line) => line.startsWith('### '));
  if (firstItem === -1) {
    const firstImage = lines.findIndex(isImage);
    const at = firstImage === -1 ? lines.length : firstImage;
    return { from: at, to: at };
  }
  const nextImage = lines.slice(firstItem).findIndex(isImage);
  return { from: firstItem, to: nextImage === -1 ? lines.length : firstItem + nextImage };
}

/**
 * メニューの節の品目を差し替える。LLM が書いた品目の範囲を丸ごと消し (品目ごとの説明・`<img>`・コピーライトの行も含む)、
 * そこに品目を並べる。節が無い、または品目が無ければそのまま。
 */
export function replaceMenuItems(content: string, itemLines: string[]): string {
  const range = findSection(content, MENU_SECTION);
  if (!range || itemLines.length === 0) return content;

  const lines = content.slice(range.start, range.end).split('\n');
  const { from, to } = llmItemRange(lines);
  const before = lines.slice(0, from).join('\n').replace(/\n+$/, '');
  const after = lines.slice(to).join('\n').replace(/^\n+/, '');
  const body = `${before}\n\n${itemLines.join('\n\n')}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
  return replaceSectionBody(content, range, body.endsWith('\n') ? body : `${body}\n`);
}

/** メニューの表の文言 (`sections/02-menu.yaml` の `rendered.table`) */
export interface MenuTableConfig {
  head_character: string;
  head_menu: string;
  no_character: string;
  menu_cell: string;
}

/**
 * メニューの表 (品目に写真が 1 枚も付かないとき、品目の見出しの代わりに画像の下に置く。2026-10-15 BOSS 決定)。
 * 行の見出し (th) はキャラクター名 (無ければ no_character)、セル (td) は品名と価格。名前は外部のページから読んだ値なので
 * MDX の式・JSX として評価されないようにする。HTML で書いた表には MDX の components (横スクロールの枠) が当たらないので、
 * 枠 (`article-table-scroll`、Frontend の globals.css) も自分で付ける
 */
export function renderMenuTable(items: ExtractionMenuItem[], config: MenuTableConfig): string {
  const rows = items.map((item) => {
    const character = item.character ? escapeMdxText(item.character) : config.no_character;
    const menu = fillTemplate(config.menu_cell, {
      name: escapeMdxText(item.name),
      price: item.price ? escapeMdxText(item.price) : null,
    });
    return `<tr><th scope="row">${character}</th><td>${menu}</td></tr>`;
  });
  return [
    '<div className="article-table-scroll">',
    '<table>',
    `<thead><tr><th scope="col">${config.head_character}</th><th scope="col">${config.head_menu}</th></tr></thead>`,
    '<tbody>',
    ...rows,
    '</tbody>',
    '</table>',
    '</div>',
  ].join('\n');
}

/**
 * メニューの節の品目を表に置き換える。LLM が書いた品目の見出しを消し、表を節の末尾 (メニューの画像の下) に置く。
 * 節が無ければそのまま
 */
export function replaceMenuItemsWithTable(content: string, table: string): string {
  const range = findSection(content, MENU_SECTION);
  if (!range || !table) return content;

  const lines = content.slice(range.start, range.end).split('\n');
  const { from, to } = llmItemRange(lines);
  const kept = [...lines.slice(0, from), ...lines.slice(to)].join('\n').replace(/\n{3,}/g, '\n\n');
  return appendToSection(replaceSectionBody(content, range, kept), MENU_SECTION, table);
}

/** 会場の一覧の書き方 (`sections/05-summary.yaml` の `rendered`) */
export interface VenueListConfig {
  venue_list_item: string;
  venue_list_separator: string;
}

/**
 * まとめの表の「開催場所」のセル。会場が 2 つ以上なら 1 会場ずつ venue_list_item で書いて venue_list_separator でつなぎ、
 * 1 つなら名前だけ (2026-10-15 BOSS 決定)。会場名は外部のページから読んだ値なので、MDX の式・JSX として評価されないようにし、
 * 表の区切りの | も全角にする (区切りの <br /> はそのまま)
 */
export function renderVenueList(venues: readonly string[], config: VenueListConfig): string {
  const safe = venues.map((venue) => tableCell(escapeMdxText(venue)));
  if (safe.length <= 1) return safe[0] ?? '';
  return safe.map((venue) => fillTemplate(config.venue_list_item, { venue })).join(config.venue_list_separator);
}

/**
 * まとめの表の、`label` の行のセルを `value` で置き換える。本文の LLM が `{{会場一覧表記}}` を残さず自分で書いた場所
 * (「東京・愛知・大阪・北海道の各会場」など) を、コードが組み立てた会場の一覧にするため (2026-10-15)。
 * まとめの表は記事の最後にあるので、最後の行を置き換える (前の節の表に同じ名前の行があっても触らない)。
 * 行の末尾の | は無くてもよい。行が無い、または値が空ならそのまま
 */
export function replaceSummaryRowValue(content: string, label: string, value: string): string {
  if (!label || !value) return content;
  const last = summaryRowMatches(content, label).at(-1);
  if (!last || last.index === undefined) return content;
  return `${content.slice(0, last.index)}| ${label} | ${value} |${content.slice(last.index + last[0].length)}`;
}

/**
 * まとめの表の `label` の行を `value` にする。行が無ければ、`after` に並べた行のうち最初に見つかった行の直後に足す
 * (本文の LLM が行ごと書かないことがあるため。2026-10-17、ヒロアカ・コナンで「お問い合わせ」が無かった)。
 * 見るのは記事の最後の節 (まとめ) の中だけ (前の節の表の同じ名前の行には触らない)。
 */
export function upsertSummaryRow(
  content: string,
  label: string,
  value: string,
  after: readonly string[],
): { content: string; status: 'replaced' | 'inserted' | 'missing' } {
  const sections = [...content.matchAll(/^## /gm)];
  const start = sections.at(-1)?.index ?? 0;
  const head = content.slice(0, start);
  const section = content.slice(start);
  const row = summaryRowMatches(section, label).at(-1);
  if (row?.index !== undefined) {
    const end = row.index + row[0].length;
    return { content: `${head}${section.slice(0, row.index)}| ${label} | ${value} |${section.slice(end)}`, status: 'replaced' };
  }
  for (const name of after) {
    const anchor = summaryRowMatches(section, name).at(-1);
    if (anchor?.index === undefined) continue;
    const end = anchor.index + anchor[0].length;
    return { content: `${head}${section.slice(0, end)}\n| ${label} | ${value} |${section.slice(end)}`, status: 'inserted' };
  }
  return { content, status: 'missing' };
}

/** 表の `label` の行 (行の末尾の | は無くてもよい) */
function summaryRowMatches(content: string, label: string): RegExpMatchArray[] {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...content.matchAll(new RegExp(`^\\|[ \\t]*${escapedLabel}[ \\t]*\\|.*$`, 'gm'))];
}

/**
 * ノベルティの節の、見出しの直後の段落 (最初の地の文) を差し替える。節が無ければそのまま。
 * 地の文が無ければ見出しの直後に入れる。
 */
export function replaceNoveltySentence(content: string, sentence: string): string {
  const range = findSection(content, NOVELTY_SECTION);
  if (!range || !sentence) return content;

  const body = content.slice(range.start, range.end);
  // 見出し・表・画像の欄でない、最初の段落
  const paragraph = [...body.matchAll(/\n\n?([^\n]+(?:\n(?!\n)[^\n]+)*)/g)].find(
    (match) => !/^(?:#|\|)/.test(match[1]) && !IMAGE_LINE.test(match[1])
  );
  const replaced = paragraph
    ? body.slice(0, paragraph.index) + body.slice(paragraph.index!).replace(paragraph[1], () => sentence)
    : `\n\n${sentence}${body}`;
  return replaceSectionBody(content, range, replaced);
}
