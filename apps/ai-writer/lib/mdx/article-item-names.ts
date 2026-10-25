/**
 * 記事 (MDX) のメニュー・グッズ・ノベルティの品名と価格を読み、更新の前後で比べる (2026-10-24 BOSS 決定)。
 *
 * 数の比較 (`article-counts.ts`) だけでは、品名の読み違いが見えない。ヒロアカの更新 (revolution #387) では、
 * Vision が「バナナカスタードドーナツ」を「バナナカスタードアイスドーナツ」と読み、公開後に手で直した品名が
 * 誤りに戻ったが、数は 19 → 19 のままだった。品名・価格・キャラクター名の変化を PR の本文に並べ、人が確かめられるようにする。
 *
 * 品目の行は数えるときと同じ規則で拾う (`sectionItemLines`)。品名は表記の揺れと種類数の注記を無視して照合する
 * (`itemNameKey`)。名前の変わった品目を「どれがどれに変わったか」と結びつけることはしない (推測になるため)。
 * 更新前にだけある品名と、更新後にだけある品名を並べる。
 */
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { characterKey } from '@/lib/services/vision-api/merge-vision-into-extraction';
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

/**
 * 価格: 「2,090円」「990円(税込)」「605円（税抜）」「¥1,100」。品名の中の「100円ショップ」で切らないよう、
 * 行の頭か空白の直後にあり、行の終わり・空白・括弧・「〜」「/」「、」の手前で終わるものだけを価格とみなす。
 * 1 行に価格が 2 つ以上あれば (「S 500円 / L 700円」)、最初の価格だけを読む (後ろの価格だけの変化は見えない)
 */
const PRICE = /(?<=^|\s)(?:[\d,]+円|[¥￥][\d,]+)(?:\s*[(（](?:税込|税抜)[)）])?(?=$|\s|[（(〜～~/／、,])/;
/** Markdown の表のセルが価格だけか */
const PRICE_CELL = /^(?:[\d,]+円|[¥￥][\d,]+)(?:\s*[(（](?:税込|税抜)[)）])?$/;
/** 価格の数字と、税込・税抜の注記 */
const PRICE_PARTS = /([\d,]+)円?(?:\s*[(（](税込|税抜)[)）])?/;
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
    const name = cells.find((cell) => cell && !PRICE_CELL.test(cell)) ?? '';
    const price = cells.find((cell) => PRICE_CELL.test(cell));
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

/** 品名は同じで、価格かキャラクター名が変わった品目 (`before` / `after` は変わった値) */
export interface ItemChange {
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
  priceChanged: ItemChange[];
  /** 品名は同じで、キャラクター名が変わった品目 (前後の両方にキャラクター名があるときだけ比べる) */
  characterChanged: ItemChange[];
}

/**
 * 価格が同じか。数字で比べ、税込・税抜の注記は両方に書かれているときだけ比べる
 * (「990円」と「990円（税込）」のような表記だけの違いを、価格の変化にしない)
 */
export function samePrice(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const [, aDigits, aTax] = a.match(PRICE_PARTS) ?? [];
  const [, bDigits, bTax] = b.match(PRICE_PARTS) ?? [];
  if (!aDigits || !bDigits) return a === b;
  return aDigits.replace(/,/g, '') === bDigits.replace(/,/g, '') && (!aTax || !bTax || aTax === bTax);
}

/** キャラクター名が変わったか (片方に無ければ比べない) */
function characterChanged(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && characterKey(a) !== characterKey(b);
}

/**
 * 同じ品名が 2 つ以上あっても、その数だけ対応づける (多い分を removed / added にする)。
 * 先に品名と価格が同じものを対応づけ、残りを品名だけで対応づける (同じ名前で価格の違う品目の並びが変わっても、
 * 価格の変化にしない)。removed は更新前の記事の順
 */
function diffItems(before: readonly ArticleItem[], after: readonly ArticleItem[]) {
  const remaining = new Map<string, ArticleItem[]>();
  for (const item of before) {
    const key = itemNameKey(item.name);
    remaining.set(key, [...(remaining.get(key) ?? []), item]);
  }
  const pairs = new Map<ArticleItem, ArticleItem>();
  const take = (item: ArticleItem, withPrice: boolean) => {
    const candidates = remaining.get(itemNameKey(item.name)) ?? [];
    const index = candidates.findIndex((b) => !withPrice || samePrice(b.price, item.price));
    if (index !== -1) pairs.set(item, candidates.splice(index, 1)[0]);
  };
  for (const item of after) take(item, true);
  for (const item of after) if (!pairs.has(item)) take(item, false);

  const unmatched = new Set([...remaining.values()].flat());
  const changes = (changed: (a: ArticleItem, b: ArticleItem) => boolean, value: (i: ArticleItem) => string | null) =>
    after.flatMap((item): ItemChange[] => {
      const previous = pairs.get(item);
      return previous && changed(previous, item) ? [{ item, before: value(previous), after: value(item) }] : [];
    });
  return {
    removed: before.filter((item) => unmatched.has(item)),
    added: after.filter((item) => !pairs.has(item)),
    priceChanged: changes((a, b) => !samePrice(a.price, b.price), (i) => i.price),
    characterChanged: changes((a, b) => characterChanged(a.character, b.character), (i) => i.character),
  };
}

export function diffArticleItems(before: ArticleItems, after: ArticleItems): ItemNameDiff[] {
  return ITEM_KEYS.map((key) => {
    const comparable = before[key].length > 0;
    const diff = comparable
      ? diffItems(before[key], after[key])
      : { removed: [], added: [], priceChanged: [], characterChanged: [] };
    return { key, label: COUNT_LABELS[key], comparable, ...diff };
  });
}

/** 節に名前・価格・キャラクター名の変化が 1 つでもあるか */
function diffHasChanges(d: ItemNameDiff): boolean {
  return d.removed.length > 0 || d.added.length > 0 || d.priceChanged.length > 0 || d.characterChanged.length > 0;
}

/** どれかの節に変化があるか */
export function hasItemChanges(diffs: readonly ItemNameDiff[]): boolean {
  return diffs.some(diffHasChanges);
}

/** キャラクター名つきの品名 (価格は付けない) */
function showName(item: ArticleItem): string {
  return `${item.character ? `【${item.character}】` : ''}${item.name}`;
}

function showItem(item: ArticleItem): string {
  return `${showName(item)}${item.price ? ` ${item.price}` : ''}`;
}

/** ログと PR 本文に載せる Markdown の箇条書きの行 (変化は 1 段下げる) */
export function describeItemNameDiffs(diffs: readonly ItemNameDiff[]): string[] {
  return diffs.flatMap((d) => {
    if (!d.comparable) return [`- ${d.label}: 比べられない (更新前の記事で品名が読めない)`];
    if (!diffHasChanges(d)) return [`- ${d.label}: 変わっていない`];
    return [
      `- ${d.label}:`,
      ...d.removed.map((item) => `  - 更新前にだけある: ${showItem(item)}`),
      ...d.added.map((item) => `  - 更新後にだけある: ${showItem(item)}`),
      ...d.priceChanged.map(
        ({ item, before, after }) => `  - 価格が変わった: ${showName(item)} ${before ?? '(なし)'} → ${after ?? '(なし)'}`
      ),
      ...d.characterChanged.map(
        ({ item, before, after }) => `  - キャラクター名が変わった: ${item.name} 【${before}】 → 【${after}】`
      ),
    ];
  });
}
