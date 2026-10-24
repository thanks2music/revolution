/**
 * 記事 (MDX) のメニュー・グッズ・ノベルティの品名と価格を読み、更新の前後で比べる (2026-10-24 BOSS 決定)。
 *
 * 数の比較 (`article-counts.ts`) だけでは、品名の読み違いが見えない。ヒロアカの更新 (revolution #387) では、
 * Vision が「バナナカスタードドーナツ」を「バナナカスタードアイスドーナツ」と読み、公開後に手で直した品名が
 * 誤りに戻ったが、数は 19 → 19 のままだった。品名と価格の変化を PR の本文に並べ、人が確かめられるようにする。
 *
 * 品目の行は数えるときと同じ規則で拾う (`sectionItemLines`)。品名は表記の揺れと種類数の注記を無視して照合する
 * (`itemNameKey`)。名前の変わった品目を「どれがどれに変わったか」と結びつけることはしない (推測になるため)。
 * 更新前にだけある品名と、更新後にだけある品名を並べる。
 */
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { COUNT_LABELS, SECTION_HEADINGS, sectionItemLines, sectionLines, splitBody, type CountKey } from './article-counts';

type ItemKey = Exclude<CountKey, 'venues'>;

const ITEM_KEYS: readonly ItemKey[] = ['menu', 'goods', 'novelty'];

export interface ArticleItem {
  /** 記事に書かれた品名 (キャラクター名・価格・販売先を除く) */
  name: string;
  /** メニューのキャラクター名 (書かれていなければ null) */
  character: string | null;
  /** 価格の表記 (「2,090円(税込)」。書かれていなければ null) */
  price: string | null;
}

/** 「2,090円」「990円(税込)」「605円（税抜）」 */
const PRICE = /[\d,]+円(?:\s*[(（](?:税込|税抜)[)）])?/;
/** 見出しの頭の「【キャラ】」 */
const CHARACTER_PREFIX = /^【([^】]+)】\s*/;
/** HTML の表の行 (`<tr><th scope="row">キャラ</th><td>品名 価格</td></tr>`) */
const HTML_ROW = /^<tr><th scope="row">(.*?)<\/th><td>(.*?)<\/td><\/tr>$/;

/** 品名と価格に分ける。価格より後ろ (販売先など) は捨てる */
function splitPrice(text: string): { name: string; price: string | null } {
  const match = text.match(PRICE);
  if (!match || match.index === undefined) return { name: text.trim(), price: null };
  return { name: text.slice(0, match.index).trim(), price: match[0].replace(/\s+/g, '') };
}

/** 品目の行 1 つを品名・キャラクター名・価格に分ける。品名が読めなければ null */
export function parseItemLine(line: string): ArticleItem | null {
  let character: string | null = null;
  let text: string;

  const row = line.match(HTML_ROW);
  if (row) {
    character = row[1].trim() || null;
    text = row[2];
  } else if (line.startsWith('|')) {
    // Markdown の表: 価格でない最初のセルを品名、価格のセルを価格とする
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const name = cells.find((cell) => cell && !PRICE.test(cell)) ?? '';
    const price = cells.find((cell) => PRICE.test(cell));
    text = price ? `${name} ${price}` : name;
  } else {
    text = line.replace(/^(?:###|-)\s+/, '');
    const prefix = text.match(CHARACTER_PREFIX);
    if (prefix) {
      character = prefix[1].trim() || null;
      text = text.slice(prefix[0].length);
    }
  }

  const { name, price } = splitPrice(text);
  return itemNameKey(name) ? { name, character, price } : null;
}

export type ArticleItems = Record<ItemKey, ArticleItem[]>;

export function readArticleItems(mdx: string): ArticleItems {
  const body = splitBody(mdx);
  const items = (key: ItemKey) =>
    sectionItemLines(sectionLines(body, SECTION_HEADINGS[key]))
      .map(parseItemLine)
      .filter((item): item is ArticleItem => item !== null);
  return { menu: items('menu'), goods: items('goods'), novelty: items('novelty') };
}

export interface PriceChange {
  item: ArticleItem;
  before: string | null;
  after: string | null;
}

export interface ItemNameDiff {
  key: ItemKey;
  label: string;
  /** 更新前の記事で品名が読めたか (読めなければ比べない) */
  comparable: boolean;
  /** 更新前にだけある品目 */
  removed: ArticleItem[];
  /** 更新後にだけある品目 */
  added: ArticleItem[];
  /** 品名は同じで、価格が変わった品目 */
  priceChanged: PriceChange[];
}

/** 同じ品名が 2 つ以上あっても、その数だけ対応づける (多い分を removed / added にする) */
function diffItems(before: readonly ArticleItem[], after: readonly ArticleItem[]) {
  const remaining = new Map<string, ArticleItem[]>();
  for (const item of before) {
    const key = itemNameKey(item.name);
    remaining.set(key, [...(remaining.get(key) ?? []), item]);
  }
  const added: ArticleItem[] = [];
  const priceChanged: PriceChange[] = [];
  for (const item of after) {
    const matches = remaining.get(itemNameKey(item.name));
    const previous = matches?.shift();
    if (!previous) {
      added.push(item);
    } else if (previous.price !== item.price) {
      priceChanged.push({ item, before: previous.price, after: item.price });
    }
  }
  return { removed: [...remaining.values()].flat(), added, priceChanged };
}

export function diffArticleItems(before: ArticleItems, after: ArticleItems): ItemNameDiff[] {
  return ITEM_KEYS.map((key) => {
    const comparable = before[key].length > 0;
    const diff = comparable ? diffItems(before[key], after[key]) : { removed: [], added: [], priceChanged: [] };
    return { key, label: COUNT_LABELS[key], comparable, ...diff };
  });
}

/** 名前・価格の変化が 1 つでもあるか */
export function hasItemChanges(diffs: readonly ItemNameDiff[]): boolean {
  return diffs.some((d) => d.removed.length > 0 || d.added.length > 0 || d.priceChanged.length > 0);
}

function showItem(item: ArticleItem): string {
  return `${item.character ? `【${item.character}】` : ''}${item.name}${item.price ? ` ${item.price}` : ''}`;
}

/** ログと PR 本文に載せる行 (箇条書きの入れ子。頭の「- 」は呼び出し側で付ける) */
export function describeItemNameDiffs(diffs: readonly ItemNameDiff[]): string[] {
  return diffs.flatMap((d) => {
    if (!d.comparable) return [`${d.label}: 比べられない (更新前の記事で品名が読めない)`];
    if (d.removed.length === 0 && d.added.length === 0 && d.priceChanged.length === 0) {
      return [`${d.label}: 変わっていない`];
    }
    return [
      `${d.label}:`,
      ...d.removed.map((item) => `  - 更新前にだけある: ${showItem(item)}`),
      ...d.added.map((item) => `  - 更新後にだけある: ${showItem(item)}`),
      ...d.priceChanged.map(
        ({ item, before, after }) => `  - 価格が変わった: ${item.name} ${before ?? '(なし)'} → ${after ?? '(なし)'}`
      ),
    ];
  });
}
