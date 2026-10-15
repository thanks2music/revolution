/**
 * 「この記事のポイント」の枠 (リード文の直後、2026-10-15 BOSS 決定。記事の改善プランの PR-4)
 *
 * 枠の中は 1 つの箇条書き。上から事実の行 (この関数群が抽出結果から組み立てる)、続けて LLM が書いた
 * 「本イベントの特徴」(`article-points-generation.service.ts`)。値の無い行は出さない (「なし」とは書かない)。
 *
 * 事実の行の順 (BOSS 決定): ① 開催期間と会場 → ② 描き下ろし・描き起こし → ③ グッズ → ④ メニュー → ⑤ ノベルティ
 * - ① 会場ごとに期間が違っても、全体の期間 (最も早い開始〜最も遅い終了) と会場の数の 1 行にする
 * - ② 公式のページに語があるときだけ
 * - ③ ④ 種類と数だけ (中身は特徴と本文に任せる)
 * - ⑤ 名前を並べる。ただしノベルティの文脈に「描き下ろし」「描き起こし」があるときだけ
 *
 * 書式は Templates の `sections/01b-points.yaml` の `rendered` (YAML が SoT)。差し込む値は外部のページから読んだものなので、
 * MDX の式・JSX として評価されないようにする (`escapeMdxText`)。枠の部品は Frontend の `components/molecules/ArticlePoints.tsx`。
 */
import type { SubpageGoodsItem } from '@revolution/schemas/subpage-extraction-response';
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { escapeMdxText } from '@/lib/utils/mdx-safety';
import { mentionsRedrawnIllustration, type RedrawnWord } from '@/lib/utils/redrawn-illustration';
import { fillTemplate, loadRendered } from './section-renderers';

const POINTS_FORMAT_KEYS = [
  'date',
  'date_same_year',
  'period',
  'period_open',
  'place_single',
  'place_multi',
  'place_multi_count_only',
  'schedule_line',
  'redrawn_line',
  'goods_line',
  'goods_channel_store',
  'goods_channel_online',
  'menu_line',
  'novelty_line',
] as const;

/** `sections/01b-points.yaml` の `rendered` (キーは上の一覧だけで決まる) */
export type PointsFormat = Record<(typeof POINTS_FORMAT_KEYS)[number], string>;

/**
 * @throws `01b-points.yaml` か、その `rendered` のキーが無いとき (`pnpm sync:templates` が要る)
 */
export function loadPointsFormat(dir?: string): PointsFormat {
  return loadRendered<PointsFormat>('01b-points.yaml', POINTS_FORMAT_KEYS, dir);
}

export interface PointsFactsInput {
  /**
   * 全体の開催期間 (YYYY-MM-DD)。`extractEventFactCardFields` の値 (全会場の和集合。終了日の分からない会場があれば end は無い。
   * event_data が無ければ抽出結果の開催期間)
   */
  period: { start?: string; end?: string };
  /** ユニークな会場名 (`storeContext.会場一覧`。無ければ呼び出し側が会場の表記 1 つを渡す) */
  venues: readonly string[];
  /** 開催地 (都道府県を短くしたもの。`storeContext.都市一覧`) */
  cities: readonly string[];
  /** 公式のページにあった語 (無ければ null) */
  redrawnWord: RedrawnWord | null;
  goodsNames: readonly string[] | null | undefined;
  goodsDetails: readonly SubpageGoodsItem[] | null | undefined;
  menuCount: number;
  noveltyNames: readonly string[] | null | undefined;
  /** ノベルティの文脈に「描き下ろし」「描き起こし」があるか (`noveltyContextMentionsRedrawn`) */
  noveltyRedrawn: boolean;
}

/** YYYY-MM-DD を分ける (形が違えば null) */
function dateParts(iso: string): { year: string; month: string; day: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) };
}

/** 全体の開催期間。開始日が無ければ null。終了日が無ければ終わりは書かない (`period_open`) */
export function formatPeriod(period: PointsFactsInput['period'], format: PointsFormat): string | null {
  const startParts = period.start ? dateParts(period.start) : null;
  if (!startParts) return null;
  const startText = fillTemplate(format.date, startParts);
  const endParts = period.end ? dateParts(period.end) : null;
  if (!endParts) return fillTemplate(format.period_open, { start: startText });
  const endText = fillTemplate(endParts.year === startParts.year ? format.date_same_year : format.date, endParts);
  return fillTemplate(format.period, { start: startText, end: endText });
}

/** 会場: 1 つなら会場名、2 つ以上なら開催地と会場の数 (開催地が分からなければ数だけ)。会場が無ければ null */
export function formatPlace(venues: readonly string[], cities: readonly string[], format: PointsFormat): string | null {
  if (venues.length === 0) return null;
  if (venues.length === 1) return fillTemplate(format.place_single, { venue: escapeMdxText(venues[0]) });
  const count = String(venues.length);
  if (cities.length === 0) return fillTemplate(format.place_multi_count_only, { count });
  return fillTemplate(format.place_multi, { cities: cities.map(escapeMdxText), count });
}

/** グッズの販売方法 (店舗 / オンライン)。販売方法が 1 つも読めなければ空 */
function goodsChannels(details: PointsFactsInput['goodsDetails'], format: PointsFormat): string[] {
  const sales = new Set((details ?? []).map((item) => item.sales).filter(Boolean));
  const channels: string[] = [];
  if (sales.has('store') || sales.has('store_only') || sales.has('store_and_online')) channels.push(format.goods_channel_store);
  if (sales.has('online_only') || sales.has('store_and_online')) channels.push(format.goods_channel_online);
  return channels;
}

/**
 * グッズの品目の数。詳細 (下層ページの品名・価格・販売方法。オンライン限定を含む) とグッズ名 (トップにしか無い品目を含む) を、
 * 品名の表記の揺れを無視して合わせた数 (どちらか片方だけでは、本文のグッズの節と数が合わないことがある)
 */
// 表記の揺れは itemNameKey の範囲だけ吸収する。詳細とグッズ名で略称が違うような大きな違いは別の品目として数える (既知の限界)
export function countGoods(names: PointsFactsInput['goodsNames'], details: PointsFactsInput['goodsDetails']): number {
  const keys = new Set([...(details ?? []).map((item) => item.name), ...(names ?? [])].map(itemNameKey).filter(Boolean));
  return keys.size;
}

/** 事実の行 (箇条書きの記号は付けない)。値の無い行は出さない */
export function buildFactLines(input: PointsFactsInput, format: PointsFormat): string[] {
  const lines: string[] = [];

  const period = formatPeriod(input.period, format);
  const place = formatPlace(input.venues, input.cities, format);
  if (period || place) {
    lines.push(fillTemplate(format.schedule_line, { period, place, both: period && place ? 'yes' : null }));
  }

  if (input.redrawnWord) lines.push(fillTemplate(format.redrawn_line, { word: input.redrawnWord }));

  const goodsCount = countGoods(input.goodsNames, input.goodsDetails);
  if (goodsCount > 0) {
    lines.push(fillTemplate(format.goods_line, { count: String(goodsCount), channels: goodsChannels(input.goodsDetails, format) }));
  }

  if (input.menuCount > 0) lines.push(fillTemplate(format.menu_line, { count: String(input.menuCount) }));

  const novelties = input.noveltyNames ?? [];
  if (input.noveltyRedrawn && novelties.length > 0) {
    lines.push(fillTemplate(format.novelty_line, { names: novelties.map(escapeMdxText) }));
  }
  return lines;
}

/**
 * ノベルティの文脈に「描き下ろし」「描き起こし」があるか。見るのはノベルティ名・ノベルティの下層ページの本文・
 * ノベルティ名が読めた会場のページの本文 (`noveltyPageTexts`)。ページ全体の判定 (②) より狭くし、
 * グッズだけが描き下ろしのイベントでノベルティの行を出さないようにする
 */
export function noveltyContextMentionsRedrawn(
  noveltyNames: readonly string[] | null | undefined,
  noveltyPageTexts: readonly string[]
): boolean {
  return [...(noveltyNames ?? []), ...noveltyPageTexts].some((text) => mentionsRedrawnIllustration(text));
}

/**
 * LLM が書いた特徴を箇条書きの 1 行にそろえる。先頭の記号・改行を除き、Markdown の書式 (見出しの #・強調・リンク・コード) を
 * 外して地の文にし (プロンプトで禁じているが、守られなかったときに箇条書きの中で見出しやリンクにならないように)、
 * MDX として安全にする。空になれば捨てる
 */
export function cleanFeatures(features: readonly string[]): string[] {
  return features
    .map((feature) =>
      feature
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // 強調とコードの記号だけを外す (__ は名前の一部のことがあるので残す。単独の * _ は描画に影響が小さいので残す)
        .replace(/\*\*|`/g, '')
        // URL は書かせない (プロンプトで禁止)。残っていれば外す (GFM の自動リンクにならないように)
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^#+\s*/, '')
        // 番号は後ろに空白か全角の「．」があるときだけ外す (「1.5倍」の 1. を外さない)
        .replace(/^(?:[-*+・●○◆◇■□]\s*|\d+(?:[.)]\s+|．\s*))/, '')
        .trim()
    )
    .filter((feature, index, all) => feature !== '' && all.indexOf(feature) === index)
    .map(escapeMdxText);
}

/** 枠の MDX。行が無ければ空文字 (枠を出さない) */
export function renderArticlePoints(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return ['<ArticlePoints>', '', ...lines.map((line) => `- ${line}`), '', '</ArticlePoints>'].join('\n');
}

/** 記事の本文の並び (リード文 → この記事のポイント → 本文)。空の部分は飛ばし、余分な空行を作らない */
export function joinArticleParts(...parts: string[]): string {
  return parts.filter((part) => part.trim() !== '').join('\n\n');
}
