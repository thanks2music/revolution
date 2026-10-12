/**
 * 下層ページの抽出 (`subpage-extraction`) の結果を、トップページの抽出結果に合わせる (Layer 1)。
 *
 * 方針 (2026-10-12):
 *
 * - メニュー: 下層ページの一覧を正とする (メニューページは全品を載せ、トップは抜粋のことが多い)。
 *   トップにしか無い品目は、品名で重複を除いて後ろに足す (漏れなく)。価格やキャラクターが食い違えば下層の値
 * - グッズ: 下層ページの品目 (品名・価格・販売方法) を正とし、グッズの下層ページを先に並べる。グッズ名は会場で
 *   買えるもの (オンライン限定を除く) を下層の順に並べ、トップにしか無い名前を後ろに足す
 * - キャラクター名: トップと下層を合わせ、重複を除く (トップを先に並べる)
 * - 名前の重複は「（全1種）」「（ランダム7種）」のような種類数の有無を無視して見分け、種類数の付いた方を残す
 * - ノベルティ名: 下層ページから読めたときは下層だけを使い、読めなかったときだけトップを使う。会場ごとの案内ページが 2 つ以上あり、一部の会場にしか無い
 *   ノベルティは「〇〇（大阪会場のみ）」のように会場を付ける (東京の読者がもらえると誤解しないように)。
 *   付けるのは会場だけで、配布条件は書かない。すべての会場のページで地域名とノベルティが読めたときだけ付ける
 * - 下層ページの抽出は Vision より先に行う。Vision は、ここで埋めた後もまだ欠けている項目だけを読む
 */
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { SubpageGoodsItem } from '@revolution/schemas/subpage-extraction-response';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';
import { characterKey, normalizeMenuName } from '@/lib/services/vision-api/merge-vision-into-extraction';
import { isEmptyList } from '@/lib/utils/llm-values';

export interface SubpageMergeResult {
  extraction: ExtractionResult;
  /** 何を変えたか (ログ用)。空なら何も変えていない */
  changes: string[];
}

/** 名前の末尾の種類数の注記 (「（全1種）」「(ランダム12種)」) */
const COUNT_SUFFIX = /[（(][^（）()]*種[^（）()]*[)）]\s*$/;

/**
 * 商品・特典の名前の照合キー。表記の揺れに加えて、末尾の種類数の注記の有無を無視する
 * (「カラビナ付きクリアポーチ」と「カラビナ付きクリアポーチ（全1種）」を同じとみなす)。
 */
export function itemNameKey(name: string): string {
  return normalizeMenuName(name.replace(COUNT_SUFFIX, ''));
}

/**
 * 重複を除いて合わせる (先に出た位置に残す)。`preferLonger` のときは、同じキーの名前が後から来て、
 * そちらの方が長ければ (種類数の注記が付いているなど、情報が多ければ) 差し替える (商品・特典の名前用)。
 */
function unionBy(
  lists: Array<string[] | null | undefined>,
  key: (value: string) => string,
  preferLonger = false
): string[] {
  const indexByKey = new Map<string, number>();
  const result: string[] = [];
  for (const value of lists.flatMap((list) => list ?? [])) {
    const k = key(value);
    if (k.length === 0) continue;
    const index = indexByKey.get(k);
    if (index === undefined) {
      indexByKey.set(k, result.length);
      result.push(value);
    } else if (preferLonger && value.length > result[index].length) {
      result[index] = value;
    }
  }
  return result;
}

function menuItemKey(item: ExtractionMenuItem): string {
  return `${normalizeMenuName(item.name)}|${normalizeMenuName(item.character ?? '')}`;
}

function mergeMenu(
  extraction: ExtractionResult,
  pages: SubpageFacts[],
  changes: string[]
): ExtractionMenuItem[] | null {
  // メニューのページを先に並べる (他のページにも品目が書かれていることがある)
  const ordered = [...pages.filter((p) => p.kind === 'menu'), ...pages.filter((p) => p.kind !== 'menu')];
  const seen = new Set<string>();
  const fromSubpages: ExtractionMenuItem[] = [];
  for (const item of ordered.flatMap((page) => page.メニュー詳細リスト ?? [])) {
    const key = menuItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    fromSubpages.push(item);
  }
  if (fromSubpages.length === 0) return extraction.メニュー詳細リスト;

  const top: ExtractionMenuItem[] = !isEmptyList(extraction.メニュー詳細リスト)
    ? extraction.メニュー詳細リスト!
    : (extraction.具体的なメニュー名リスト ?? []).map((name) => ({
        character: null,
        name,
        price: null,
        imageUrl: null,
        copyright: null,
      }));
  // 品名だけで照合する (トップはキャラクターを書かないことがあるため)
  const topByName = new Map(top.map((item) => [normalizeMenuName(item.name), item]));
  const subpageNames = new Set(fromSubpages.map((item) => normalizeMenuName(item.name)));
  const topOnly = top.filter((item) => !subpageNames.has(normalizeMenuName(item.name)));
  // 下層の品目に無い値 (画像・コピーライトなど。下層の抽出は読まない) は、同じ品目のトップの値で補う
  const merged = fromSubpages.map((item) => {
    const fromTop = topByName.get(normalizeMenuName(item.name));
    if (!fromTop) return item;
    return {
      character: item.character ?? fromTop.character,
      name: item.name,
      price: item.price ?? fromTop.price,
      imageUrl: item.imageUrl ?? fromTop.imageUrl,
      copyright: item.copyright ?? fromTop.copyright,
    };
  });

  changes.push(
    `メニュー: 下層ページの ${fromSubpages.length} 品を使い、トップにしか無い ${topOnly.length} 品を足した (トップは ${top.length} 品)`
  );
  return [...merged, ...topOnly];
}

/**
 * ノベルティ名。会場の案内ページが 2 つ以上あるときだけ、会場による違いを書き分ける。
 */
function mergeNovelties(
  extraction: ExtractionResult,
  pages: SubpageFacts[],
  changes: string[]
): string[] | null {
  const venuePages = pages.filter((page) => page.kind === 'venue');
  const otherPages = pages.filter((page) => page.kind !== 'venue');
  // 下層ページからノベルティが読めたときは、下層だけを使う (トップの短い紹介文は特典かどうかを見分けにくく、
  // コナンでは有料プランに付く物がトップから混ざった)。下層から読めなかったときだけトップを使う (2026-10-12)
  const fromSubpages = pages.some((page) => !isEmptyList(page.ノベルティ名));
  const plain = unionBy(
    [fromSubpages ? null : extraction.ノベルティ名, ...otherPages.map((p) => p.ノベルティ名)],
    itemNameKey,
    true
  );

  // 名前ごとに、載っている会場のページを数える
  const byName = new Map<string, { name: string; pages: SubpageFacts[] }>();
  for (const page of venuePages) {
    for (const name of unionBy([page.ノベルティ名], itemNameKey, true)) {
      const key = itemNameKey(name);
      const entry = byName.get(key) ?? { name, pages: [] };
      if (name.length > entry.name.length) entry.name = name;
      entry.pages.push(page);
      byName.set(key, entry);
    }
  }

  // 会場ごとの違いを書き分けるのは、すべての会場のページで地域名とノベルティが読めたときだけ。
  // 読めなかったページ (取得の失敗、本文の切り詰め、お知らせの記事など) があると、「その会場には無い」と
  // 誤って限定を付けてしまうため (2026-10-12、コナンで「（東京・神奈川会場のみ）」と誤った)
  const comparable =
    venuePages.length >= 2 && venuePages.every((page) => page.area !== null && !isEmptyList(page.ノベルティ名));
  const common: string[] = [];
  const limited: string[] = [];
  const limitedKeys = new Set<string>();
  for (const [key, entry] of byName) {
    const areas = Array.from(new Set(entry.pages.map((page) => page.area)));
    const isLimited = comparable && entry.pages.length < venuePages.length;
    if (isLimited) {
      limited.push(`${entry.name}（${areas.join('・')}会場のみ）`);
      limitedKeys.add(key);
    } else {
      common.push(entry.name);
    }
  }

  // 会場の案内ページで限定と分かったものは、トップの書き方 (限定の記載なし) より優先する
  const merged = unionBy(
    [plain.filter((name) => !limitedKeys.has(itemNameKey(name))), common, limited],
    (name) => itemNameKey(name.replace(/（[^（）]*会場のみ）$/, '')),
    true
  );
  if (merged.length === 0) return extraction.ノベルティ名;

  const before = extraction.ノベルティ名 ?? [];
  if (merged.length !== before.length || merged.some((name, i) => name !== before[i])) {
    changes.push(
      `ノベルティ名: ${before.length} 件 → ${merged.length} 件${limited.length > 0 ? ` (会場限定 ${limited.length} 件)` : ''}`
    );
  }
  return merged;
}

/**
 * グッズ。下層ページの品目を正とし (グッズのページを先に)、会場で買えるものだけをグッズ名にする。
 * トップにしか無い名前は後ろに足す (オンライン限定と分かっている名前は足さない)。
 */
function mergeGoods(
  extraction: ExtractionResult,
  pages: SubpageFacts[],
  changes: string[]
): Pick<ExtractionResult, 'グッズ名' | 'グッズ詳細リスト'> {
  const ordered = [...pages.filter((p) => p.kind === 'goods'), ...pages.filter((p) => p.kind !== 'goods')];
  const indexByKey = new Map<string, number>();
  const details: SubpageGoodsItem[] = [];
  for (const item of ordered.flatMap((page) => page.グッズ詳細リスト ?? [])) {
    const key = itemNameKey(item.name);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, details.length);
      details.push(item);
    } else {
      // 同じ商品が複数のページにあれば、欠けている値を補う
      const current = details[index];
      details[index] = {
        name: item.name.length > current.name.length ? item.name : current.name,
        price: current.price ?? item.price,
        sales: current.sales ?? item.sales,
      };
    }
  }
  if (details.length === 0) {
    return { グッズ名: extraction.グッズ名, グッズ詳細リスト: extraction.グッズ詳細リスト };
  }

  const onlineOnly = new Set(details.filter((d) => d.sales === 'online_only').map((d) => itemNameKey(d.name)));
  const atVenue = details.filter((d) => d.sales !== 'online_only').map((d) => d.name);
  const fromTop = (extraction.グッズ名 ?? []).filter((name) => !onlineOnly.has(itemNameKey(name)));
  const グッズ名 = unionBy([atVenue, fromTop], itemNameKey, true);

  changes.push(
    `グッズ: 下層ページの ${details.length} 件 (うちオンライン限定 ${onlineOnly.size} 件) を読み、会場で買えるグッズ名は ${グッズ名.length} 件`
  );
  return { グッズ名: グッズ名.length > 0 ? グッズ名 : null, グッズ詳細リスト: details };
}

function mergeNames(
  label: string,
  current: string[] | null,
  fromPages: Array<string[] | null>,
  key: (value: string) => string,
  changes: string[]
): string[] | null {
  const merged = unionBy([current, ...fromPages], key);
  if (merged.length === 0) return current;
  const added = merged.length - (current?.length ?? 0);
  if (added > 0) changes.push(`${label}: 下層ページから ${added} 件を足した`);
  return merged;
}

export function mergeSubpagesIntoExtraction(
  extraction: ExtractionResult,
  pages: SubpageFacts[]
): SubpageMergeResult {
  const changes: string[] = [];
  const メニュー詳細リスト = mergeMenu(extraction, pages, changes);
  const goods = mergeGoods(extraction, pages, changes);
  const キャラクター名 = mergeNames(
    'キャラクター名',
    extraction.キャラクター名,
    pages.map((p) => p.キャラクター名),
    characterKey,
    changes
  );
  const ノベルティ名 = mergeNovelties(extraction, pages, changes);

  if (changes.length === 0) return { extraction, changes };
  return {
    extraction: { ...extraction, メニュー詳細リスト, ...goods, キャラクター名, ノベルティ名 },
    changes,
  };
}
