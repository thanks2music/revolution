/**
 * 下層ページの抽出 (`subpage-extraction`) の結果を、トップページの抽出結果に合わせる (Layer 1)。
 *
 * 方針 (2026-10-12):
 *
 * - メニュー: 下層ページの一覧を正とする (メニューページは全品を載せ、トップは抜粋のことが多い)。
 *   トップにしか無い品目は、品名で重複を除いて後ろに足す (漏れなく)。価格やキャラクターが食い違えば下層の値
 * - グッズ名・キャラクター名: トップと下層を合わせ、重複を除く (トップを先に並べる)
 * - ノベルティ名: トップと下層を合わせる。会場ごとの案内ページが 2 つ以上あり、一部の会場にしか無い
 *   ノベルティは「〇〇（大阪会場のみ）」のように会場を付ける (東京の読者がもらえると誤解しないように)。
 *   付けるのは会場だけで、配布条件は書かない。会場の地域名が読み取れなかったときは付けない
 * - 下層ページの抽出は Vision より先に行う。Vision は、ここで埋めた後もまだ欠けている項目だけを読む
 */
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { SubpageFacts } from '@/lib/services/subpage-extraction.service';
import { characterKey, normalizeMenuName } from '@/lib/services/vision-api/merge-vision-into-extraction';
import { isEmptyList } from '@/lib/utils/llm-values';

export interface SubpageMergeResult {
  extraction: ExtractionResult;
  /** 何を変えたか (ログ用)。空なら何も変えていない */
  changes: string[];
}

/** 重複を除いて合わせる (先に出たものを残す) */
function unionBy(lists: Array<string[] | null | undefined>, key: (value: string) => string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of lists.flatMap((list) => list ?? [])) {
    const k = key(value);
    if (k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    result.push(value);
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
  const subpageNames = new Set(fromSubpages.map((item) => normalizeMenuName(item.name)));
  const topOnly = top.filter((item) => !subpageNames.has(normalizeMenuName(item.name)));

  changes.push(
    `メニュー: 下層ページの ${fromSubpages.length} 品を使い、トップにしか無い ${topOnly.length} 品を足した (トップは ${top.length} 品)`
  );
  return [...fromSubpages, ...topOnly];
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
  const plain = unionBy([extraction.ノベルティ名, ...otherPages.map((p) => p.ノベルティ名)], normalizeMenuName);

  // 名前ごとに、載っている会場のページを数える
  const byName = new Map<string, { name: string; pages: SubpageFacts[] }>();
  for (const page of venuePages) {
    for (const name of unionBy([page.ノベルティ名], normalizeMenuName)) {
      const key = normalizeMenuName(name);
      const entry = byName.get(key) ?? { name, pages: [] };
      entry.pages.push(page);
      byName.set(key, entry);
    }
  }

  const common: string[] = [];
  const limited: string[] = [];
  const limitedKeys = new Set<string>();
  for (const [key, entry] of byName) {
    const areas = Array.from(new Set(entry.pages.map((page) => page.area)));
    const isLimited =
      venuePages.length >= 2 && entry.pages.length < venuePages.length && areas.every((area) => area !== null);
    if (isLimited) {
      limited.push(`${entry.name}（${areas.join('・')}会場のみ）`);
      limitedKeys.add(key);
    } else {
      common.push(entry.name);
    }
  }

  // 会場の案内ページで限定と分かったものは、トップの書き方 (限定の記載なし) より優先する
  const merged = unionBy(
    [plain.filter((name) => !limitedKeys.has(normalizeMenuName(name))), common, limited],
    normalizeMenuName
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
  const グッズ名 = mergeNames('グッズ名', extraction.グッズ名, pages.map((p) => p.グッズ名), normalizeMenuName, changes);
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
    extraction: { ...extraction, メニュー詳細リスト, グッズ名, キャラクター名, ノベルティ名 },
    changes,
  };
}
