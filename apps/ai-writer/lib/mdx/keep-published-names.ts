/**
 * 記事の更新で、公開中の記事の品名を正にする (Layer 1、2026-10-25 BOSS 決定)
 *
 * 公開中の記事を作り直すと、Vision や抽出の LLM が品名を読み違えることがあり、公開後に人が直した品名が誤りに
 * 戻る (#387。Gemini の Vision は「バナナカスタードドーナツ」を 8 回中 3 回「バナナカスタードアイスドーナツ」と読んだ)。
 * 人が確かめた値は公開中の記事の中にあるので、更新ではそちらを正にする。
 *
 * 当てるのは、今回読んだ品名と公開中の記事の品名を照合して (`itemNameKey`)、どちらにも対応の無い品目が
 * 「同じキャラクター・同じ価格」の組の中で 1 品どうしだけ残り、**2 つの名前が似ている** (読み違いらしい) ときに限る。
 * そのときは公開中の記事の品名を使う。2 品以上残った組は、どれがどれか決められないので当てない (推測しない)。
 * 名前が似ていなければ、公式が品目を入れ替えた可能性が高いので当てない (キャラクターも価格も無いノベルティなどは、
 * 無関係な品目どうしが同じ組になるため、この条件が要る)。
 *
 * 当てた品目は呼び出し側がログと PR の本文に出す。公式サイトが本当に品名を変えたときも公開中の記事の品名が
 * 残るので、人が PR で確かめる。キャラクター名と価格は当てない (違いは `article-item-names.ts` が PR の本文に出す)。
 */
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { characterKey } from '@/lib/services/vision-api/merge-vision-into-extraction';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import { COUNT_LABELS } from './article-counts';
import type { ArticleItem, ArticleItems } from './article-item-names';

type ItemKey = keyof ArticleItems;

/** 今回読んだ品目 (公開中の記事の品目と同じ形) */
interface ReadItem {
  name: string;
  character: string | null;
  price: string | null;
}

export interface KeptName {
  key: ItemKey;
  label: string;
  /** 今回読んだ品名 (使わなかった方) */
  read: string;
  /** 公開中の記事の品名 (使った方) */
  published: string;
  character: string | null;
  price: string | null;
}

/** 価格の数字だけ (無ければ空)。税込・税抜の注記の有無では分けない。範囲 (「990円〜1,100円」) は最初の数字で見る */
function priceDigits(price: string | null): string {
  return price?.match(/[\d,]+/)?.[0].replace(/,/g, '') ?? '';
}

/** 名前が似ているとみなす、編集距離の上限 (長い方の名前の文字数に対する割合) */
const MAX_DISTANCE_RATIO = 0.4;

/** 2 つの文字列の編集距離 (挿入・削除・置換を 1 とする) */
function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

/** ひらがなをカタカナにそろえる (「てりマヨ」と「テリヤキ」の違いを、かなの種類で水増ししない) */
function toKatakana(text: string): string {
  return text.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * 名前が似ているか (読み違いらしいか)。照合キー (表記の揺れと種類数の注記を除いた形) どうしの編集距離が、
 * 長い方の 4 割以下なら似ているとみなす (「バナナカスタードドーナツ」と「…アイスドーナツ」は 3 / 15)。ひらがなはカタカナにそろえる
 */
export function similarNames(a: string, b: string): boolean {
  const x = toKatakana(itemNameKey(a));
  const y = toKatakana(itemNameKey(b));
  const longer = Math.max([...x].length, [...y].length);
  return longer > 0 && editDistance(x, y) / longer <= MAX_DISTANCE_RATIO;
}

/** 「同じキャラクター・同じ価格」の組のキー */
function groupKey(item: { character: string | null; price: string | null }): string {
  return `${item.character ? characterKey(item.character) : ''}\u0000${priceDigits(item.price)}`;
}

/**
 * 今回読んだ品目のうち、公開中の記事の品名を当てるもの (今回の品目の位置 → 公開中の記事の品目)。
 * 先に品名で対応づけ、残った品目を「同じキャラクター・同じ価格」の組に分け、組の中で 1 品どうしなら当てる
 */
export function publishedNamesFor(read: readonly ReadItem[], published: readonly ArticleItem[]): Map<number, ArticleItem> {
  const remaining = new Map<string, ArticleItem[]>();
  for (const item of published) {
    const key = itemNameKey(item.name);
    remaining.set(key, [...(remaining.get(key) ?? []), item]);
  }
  const unmatchedRead: number[] = [];
  read.forEach((item, index) => {
    const candidates = remaining.get(itemNameKey(item.name));
    if (candidates && candidates.length > 0) candidates.shift();
    else unmatchedRead.push(index);
  });
  const unmatchedPublished = [...remaining.values()].flat();

  const result = new Map<number, ArticleItem>();
  for (const index of unmatchedRead) {
    const key = groupKey(read[index]);
    const readInGroup = unmatchedRead.filter((i) => groupKey(read[i]) === key);
    const publishedInGroup = unmatchedPublished.filter((item) => groupKey(item) === key);
    if (readInGroup.length === 1 && publishedInGroup.length === 1 && similarNames(read[index].name, publishedInGroup[0].name)) {
      result.set(index, publishedInGroup[0]);
    }
  }
  return result;
}

/** 名前の一覧の中で、照合キーが同じ最初の名前を置き換える (同じ名前が 2 つあっても、対応した 1 つだけ) */
function renameIn(list: string[] | null, from: string, to: string): string[] | null {
  if (!list) return list;
  const key = itemNameKey(from);
  const index = list.findIndex((name) => itemNameKey(name) === key);
  return index === -1 ? list : list.map((name, i) => (i === index ? to : name));
}

type NameFields = Pick<
  ExtractionResult,
  'メニュー詳細リスト' | '具体的なメニュー名リスト' | 'グッズ詳細リスト' | 'グッズ名' | 'ノベルティ名'
>;

/** 抽出の結果から、記事に書く品目を読む (書く側と同じ優先: 詳細リストがあればそれ、無ければ名前の一覧) */
function readItems<T extends NameFields>(extraction: T): Record<ItemKey, ReadItem[]> {
  const menu = extraction.メニュー詳細リスト?.length
    ? extraction.メニュー詳細リスト.map(({ name, character, price }) => ({ name, character, price }))
    : (extraction.具体的なメニュー名リスト ?? []).map((name) => ({ name, character: null, price: null }));
  const goods = extraction.グッズ詳細リスト?.length
    ? extraction.グッズ詳細リスト.map(({ name, price }) => ({ name, character: null, price }))
    : (extraction.グッズ名 ?? []).map((name) => ({ name, character: null, price: null }));
  const novelty = (extraction.ノベルティ名 ?? []).map((name) => ({ name, character: null, price: null }));
  return { menu, goods, novelty };
}

/**
 * 抽出の結果の品名に、公開中の記事の品名を当てる。当てた品目が無ければ元の結果のまま返す。
 * メニューは詳細リストと名前の一覧、グッズは詳細リストと名前の一覧の両方を直す
 */
export function keepPublishedNames<T extends NameFields>(
  extraction: T,
  published: ArticleItems
): { extraction: T; kept: KeptName[] } {
  const read = readItems(extraction);
  const kept: KeptName[] = [];
  let result: T = extraction;
  for (const key of ['menu', 'goods', 'novelty'] as const) {
    for (const [index, item] of publishedNamesFor(read[key], published[key])) {
      const from = read[key][index];
      kept.push({ key, label: COUNT_LABELS[key], read: from.name, published: item.name, character: from.character, price: from.price });
      if (key === 'menu') {
        result = {
          ...result,
          メニュー詳細リスト: result.メニュー詳細リスト?.length
            ? result.メニュー詳細リスト.map((m, i) => (i === index ? { ...m, name: item.name } : m))
            : result.メニュー詳細リスト,
          具体的なメニュー名リスト: renameIn(result.具体的なメニュー名リスト, from.name, item.name),
        };
      } else if (key === 'goods') {
        result = {
          ...result,
          グッズ詳細リスト: result.グッズ詳細リスト?.length
            ? result.グッズ詳細リスト.map((g, i) => (i === index ? { ...g, name: item.name } : g))
            : result.グッズ詳細リスト,
          グッズ名: renameIn(result.グッズ名, from.name, item.name),
        };
      } else {
        result = { ...result, ノベルティ名: result.ノベルティ名?.map((n, i) => (i === index ? item.name : n)) ?? null };
      }
    }
  }
  return { extraction: result, kept };
}

/** ログと PR 本文に載せる Markdown の箇条書きの行 */
export function describeKeptNames(kept: readonly KeptName[]): string[] {
  if (kept.length === 0) return ['- なし'];
  return kept.map(({ label, read, published, character, price }) => {
    const detail = [character ? `【${character}】` : '', price ?? ''].filter(Boolean).join(' ');
    return `- ${label}${detail ? ` (${detail})` : ''}: 今回読んだ「${read}」ではなく、公開中の記事の「${published}」を使った`;
  });
}
