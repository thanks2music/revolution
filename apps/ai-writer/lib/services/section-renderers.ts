/**
 * 本文の節に、抽出結果をコードで差し込む (2026-10-12)
 *
 * 本文の LLM に品名やノベルティ名を書き写させると、誤字が混ざる (コナンで「招待状（ランダム7种）」と
 * 中国語の字を書いた)。そこで、名前の入る部分はコードが抽出結果から組み立て、LLM が書いたものと置き換える。
 * LLM が書くのは導入文などの地の文だけになる。
 *
 * - メニューの節: LLM が書いた品目の見出し (`### …`) を消し、`sections/02-menu.yaml` の `rendered.item_line` で全品を並べる
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

function defaultSectionsDir(): string {
  return path.join(process.cwd(), 'templates', 'collabo-cafe', 'sections');
}

/** メニューの品目の見出しを組み立てる (品名・価格・キャラクターはエスケープして差し込む) */
export function renderMenuItems(items: ExtractionMenuItem[], itemLine: string): string[] {
  return items.map((item) =>
    fillTemplate(itemLine, {
      character: item.character ? escapeMdxText(item.character) : null,
      name: escapeMdxText(item.name),
      price: item.price ? escapeMdxText(item.price) : null,
    })
  );
}

const MENU_SECTION = /^## .*メニュー[ \t]*$/m;
const NOVELTY_SECTION = /^## .*ノベルティー?[ \t]*$/m;

/**
 * メニューの節の品目を差し替える。LLM が書いた `### ` の行を消し、最初に消した位置 (無ければ最初の画像の手前、
 * それも無ければ節の末尾) に品目を並べる。節が無い、または品目が無ければそのまま。
 */
export function replaceMenuItems(content: string, itemLines: string[]): string {
  const range = findSection(content, MENU_SECTION);
  if (!range || itemLines.length === 0) return content;

  const lines = content.slice(range.start, range.end).split('\n');
  let insertAt = -1;
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (insertAt === -1) insertAt = kept.length;
      continue;
    }
    kept.push(line);
  }
  if (insertAt === -1) {
    const firstImage = kept.findIndex((line) => line.startsWith('![') || line.startsWith('{ここに'));
    insertAt = firstImage === -1 ? kept.length : firstImage;
  }
  // 品目の見出しを消した跡の空行を詰める
  const before = kept.slice(0, insertAt).join('\n').replace(/\n+$/, '');
  const after = kept.slice(insertAt).join('\n').replace(/^\n+/, '');
  const block = itemLines.join('\n\n');
  const body = `${before}\n\n${block}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
  return replaceSectionBody(content, range, body.endsWith('\n') ? body : `${body}\n`);
}

/**
 * ノベルティの節の、見出しの直後の段落 (最初の地の文) を差し替える。節が無ければそのまま。
 * 地の文が無ければ見出しの直後に入れる。
 */
export function replaceNoveltySentence(content: string, sentence: string): string {
  const range = findSection(content, NOVELTY_SECTION);
  if (!range || !sentence) return content;

  const body = content.slice(range.start, range.end);
  const paragraph = /\n\n?((?!#|!\[|\{ここに|\|)[^\n]+(?:\n(?!\n)[^\n]+)*)/.exec(body);
  const replaced = paragraph
    ? body.slice(0, paragraph.index) + body.slice(paragraph.index).replace(paragraph[1], () => sentence)
    : `\n\n${sentence}${body}`;
  return replaceSectionBody(content, range, replaced);
}
