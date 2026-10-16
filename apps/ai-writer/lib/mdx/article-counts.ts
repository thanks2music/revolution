/**
 * 記事 (MDX) に載っている会場・メニュー・グッズ・ノベルティの数を数え、更新の前後で減っていないかを確かめる。
 *
 * 公開中の記事を作り直す (`pnpm debug:mdx --update <post_id>`) とき、作り直した記事のほうが情報が少なければ
 * PR を作らずに止める (BOSS 決定 2026-10-16。`--allow-shrink` で続ける)。
 *
 * 前後とも MDX の文字列から同じ規則で数える (片方だけ抽出結果から数えると、書式の違いで食い違う)。
 * - 会場: frontmatter の `event_data.occurrences` の件数
 * - メニュー・グッズ・ノベルティ: それぞれの節 (`## …メニュー` など) の品目の行。
 *   品目の見出し (`### …`)、表の行 (`<tr><th scope="row">` / Markdown の表)、箇条書き (`- …`) を数える
 *
 * 古い記事は品目を画像だけで載せている (`### メニューラインナップ` の下に画像) ことがあり、数が読めない。
 * 更新前の数が 0 の項目は「比べられない」として止めない (BOSS 決定 2026-10-17。減ったかは差分で人が確かめる)。
 */
import { parseFrontmatter } from './parse-frontmatter';

export type CountKey = 'venues' | 'menu' | 'goods' | 'novelty';

export type ArticleCounts = Record<CountKey, number>;

export const COUNT_LABELS: Record<CountKey, string> = {
  venues: '会場',
  menu: 'メニュー',
  goods: 'グッズ',
  novelty: 'ノベルティ',
};

const COUNT_KEYS: readonly CountKey[] = ['venues', 'menu', 'goods', 'novelty'];

/** 節の見出し。`lib/services/section-renderers.ts` / `goods-list.ts` の節の判定と同じ */
const SECTION_HEADINGS: Record<Exclude<CountKey, 'venues'>, RegExp> = {
  menu: /^## .*メニュー[ \t]*$/,
  goods: /^## .*グッズ[ \t]*$/,
  novelty: /^## .*ノベルティー?[ \t]*$/,
};

/**
 * 品目ではない `###` の見出し。今の書式の「その他参考画像」「グッズ一覧」と、
 * 古い記事の「メニューラインナップ」「メニュー注文特典」「ノベルティー」など
 */
const STRUCTURAL_HEADING = /^(?:その他参考画像|グッズ一覧|ノベルティー?|.*ラインナップ|.*特典)$/;

/** Markdown の表の区切りの行 (`|------|------|`) */
const TABLE_DIVIDER = /^\|[\s:|-]+\|$/;

/** 節の本文の行 (見出しの次の行から、次の `## ` の手前まで) */
function sectionLines(body: string[], heading: RegExp): string[] {
  const start = body.findIndex((line) => heading.test(line));
  if (start === -1) return [];
  const rest = body.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/** 節の品目の数 */
export function countSectionItems(lines: readonly string[]): number {
  let items = 0;
  let tableLines = 0;
  let dividers = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('### ')) {
      if (!STRUCTURAL_HEADING.test(line.slice(4).trim())) items++;
    } else if (line.startsWith('<tr><th scope="row">')) {
      items++;
    } else if (line.startsWith('- ')) {
      items++;
    } else if (line.startsWith('|')) {
      if (TABLE_DIVIDER.test(line)) dividers++;
      else tableLines++;
    }
  }
  // Markdown の表は、区切りの行の直前の 1 行が見出しの行
  return items + Math.max(0, tableLines - dividers);
}

/** frontmatter と本文を分ける (frontmatter が無ければ全体を本文とみなす) */
function splitBody(mdx: string): string[] {
  const match = mdx.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? mdx.slice(match[0].length) : mdx).split('\n');
}

export function countArticleItems(mdx: string): ArticleCounts {
  const occurrences = parseFrontmatter(mdx)?.event_data?.occurrences;
  const body = splitBody(mdx);
  return {
    venues: Array.isArray(occurrences) ? occurrences.length : 0,
    menu: countSectionItems(sectionLines(body, SECTION_HEADINGS.menu)),
    goods: countSectionItems(sectionLines(body, SECTION_HEADINGS.goods)),
    novelty: countSectionItems(sectionLines(body, SECTION_HEADINGS.novelty)),
  };
}

export interface CountComparison {
  key: CountKey;
  label: string;
  before: number;
  after: number;
  /** 更新前の記事で数えられたか (0 なら比べない) */
  comparable: boolean;
  /** 比べられて、減った */
  shrunk: boolean;
}

export interface ShrinkCheck {
  comparisons: CountComparison[];
  /** どれかが減った */
  shrunk: boolean;
}

export function checkShrink(before: ArticleCounts, after: ArticleCounts): ShrinkCheck {
  const comparisons = COUNT_KEYS.map((key): CountComparison => {
    const comparable = before[key] > 0;
    return {
      key,
      label: COUNT_LABELS[key],
      before: before[key],
      after: after[key],
      comparable,
      shrunk: comparable && after[key] < before[key],
    };
  });
  return { comparisons, shrunk: comparisons.some((c) => c.shrunk) };
}

/** ログと PR 本文に載せる 1 行ずつの説明 */
export function describeShrinkCheck(check: ShrinkCheck): string[] {
  return check.comparisons.map(({ label, before, after, comparable, shrunk }) => {
    if (!comparable) return `${label}: 比べられない (更新前の記事で数が読めない。更新後 ${after})`;
    if (shrunk) return `${label}: ${before} → ${after} (減った)`;
    return `${label}: ${before} → ${after}`;
  });
}
