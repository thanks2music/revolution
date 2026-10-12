/**
 * Vision の結果で、HTML の抽出結果 (`ExtractionResult`) の欠けを埋める (Layer 1)。
 *
 * 呼び出し側は、確信度がレベル A のときだけ呼ぶ。方針 (2026-10-11):
 *
 * - メニュー: HTML に品目があれば **HTML の一覧だけ**を使う。Vision は、名前が一致した品目の
 *   空欄 (価格、キャラクター) を埋めるだけで、品目は足さない。HTML に品目が無ければ Vision の
 *   一覧を全品使う。品目の数に上限はなく、価格が無い品目も載せる
 * - グッズ名・ノベルティ名: HTML が空のときだけ Vision の名前を使う
 * - キャラクター名: 公式ページに「描き下ろし」「描き起こし」があれば HTML と Vision を足し合わせる
 *   (Vision を先に並べ、重複を除く)。無ければ HTML が空のときだけ Vision を使う
 * - 価格の表記: 税込・税抜が読めたら「2,090円(税込)」「2,090円(税抜)」、読めなければ「2,090円」
 * - `メニュー種類数` は作らない (一覧が一部だけのことがあり、数を推測で書かないため)
 */
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import type { ExtractionResult } from '@/lib/services/extraction.service';
import type { MenuItem, PriceTaxType, VisionExtractionResult } from '@revolution/schemas/vision-api-extraction';
import { isEmptyList } from './vision-targets';

type VisionExtraction = VisionExtractionResult['visionExtraction'];

export interface VisionMergeOptions {
  /** 公式ページに「描き下ろし」「描き起こし」の記載があるか (`lib/utils/redrawn-illustration.ts`) */
  hasRedrawnIllustrations: boolean;
}

export interface VisionMergeResult {
  extraction: ExtractionResult;
  /** 何を埋めたか (ログ用)。空なら何も変えていない */
  changes: string[];
}

/**
 * メニュー名を照合用にそろえる。全角・半角と大文字・小文字の違い、空白、括弧や引用符、
 * 波線などの装飾を無視する (「“風の”ビーフシチューハンバーグ」と「風のビーフシチューハンバーグ」を同じとみなす)。
 */
export function normalizeMenuName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'“”‘’「」『』【】()（）\[\]［］〈〉《》~〜～・･.,、。!！?？★☆♪♡]/g, '');
}

/** 価格を記事の表記にする。例: 2090 + included → "2,090円(税込)" */
export function formatPrice(price: number, taxType?: PriceTaxType): string {
  const amount = `${price.toLocaleString('ja-JP')}円`;
  if (taxType === 'included') return `${amount}(税込)`;
  if (taxType === 'excluded') return `${amount}(税抜)`;
  return amount;
}

/** 包含 (部分一致) で照合するときの、HTML の名前の最短の長さ。「パフェ」のような短い名前が多くの品目に当たらないように */
const MIN_CONTAINMENT_MATCH_LENGTH = 4;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)));
}

function visionPrice(item: MenuItem): string | null {
  return item.price != null ? formatPrice(item.price, item.priceTaxType) : null;
}

function visionCharacter(item: MenuItem): string | null {
  return item.characterName.length > 0 ? item.characterName.join('、') : null;
}

/**
 * HTML の品目に対応する Vision の品目を 1 つ選ぶ。候補が 1 つに決まらなければ選ばない (取り違えを防ぐ)。
 *
 * まず名前の一致を探す。無ければ、HTML の名前を含む Vision の品目を探す。Vision はキャラクター名を
 * 含めて読む (「五条悟の唯我独尊フルーツサンド」) が、HTML はキャラクターを別の欄に分ける
 * (「唯我独尊フルーツサンド」) ため。同じ名前の品目が複数 (キャラ違いの「コラボドリンク」など) なら選ばない。
 */
function findVisionMatch(
  htmlName: string,
  visionItems: ReadonlyArray<{ key: string; item: MenuItem }>
): MenuItem | undefined {
  const key = normalizeMenuName(htmlName);
  const exact = visionItems.filter((v) => v.key === key);
  if (exact.length > 0) return exact.length === 1 ? exact[0].item : undefined;
  if (key.length < MIN_CONTAINMENT_MATCH_LENGTH) return undefined;
  const containing = visionItems.filter((v) => v.key.includes(key));
  return containing.length === 1 ? containing[0].item : undefined;
}

/** キャラクター名の照合用。空白と中黒の揺れを無視する */
function characterKey(name: string): string {
  return name.normalize('NFKC').replace(/[\s・･]/g, '');
}

/**
 * キャラクター名を足し合わせる (Vision を先、重複を除く)。Vision と HTML で同じ人物の表記が違う
 * (一方がもう一方を含む:「虎杖」と「虎杖悠仁」、「五条悟」と「五条 悟」) ときは、公式の HTML の表記を使う。
 */
function combineCharacters(visionNames: string[], htmlNames: string[]): string[] {
  const html = htmlNames.map((name) => ({ name, key: characterKey(name) }));
  const result: string[] = [];
  const add = (name: string) => {
    if (!result.includes(name)) result.push(name);
  };
  for (const visionName of visionNames) {
    const key = characterKey(visionName);
    const same = html.find((h) => h.key.includes(key) || key.includes(h.key));
    add(same ? same.name : visionName);
  }
  html.forEach((h) => add(h.name));
  return result;
}

function mergeMenu(
  extraction: ExtractionResult,
  visionMenu: MenuItem[],
  changes: string[]
): Pick<ExtractionResult, 'メニュー詳細リスト' | '具体的なメニュー名リスト'> {
  const current = {
    メニュー詳細リスト: extraction.メニュー詳細リスト,
    具体的なメニュー名リスト: extraction.具体的なメニュー名リスト,
  };
  if (visionMenu.length === 0) return current;

  // HTML の一覧: 詳細リストが無ければ、名前だけの一覧から品目を起こす
  const htmlItems: ExtractionMenuItem[] = !isEmptyList(extraction.メニュー詳細リスト)
    ? extraction.メニュー詳細リスト!
    : (extraction.具体的なメニュー名リスト ?? []).map((name) => ({
        character: null,
        name,
        price: null,
        imageUrl: null,
        copyright: null,
      }));

  if (htmlItems.length === 0) {
    changes.push(`メニュー: HTML に品目が無いため Vision の ${visionMenu.length} 品を使う`);
    return {
      メニュー詳細リスト: visionMenu.map((item) => ({
        character: visionCharacter(item),
        name: item.name,
        price: visionPrice(item),
        imageUrl: null,
        copyright: null,
      })),
      具体的なメニュー名リスト: visionMenu.map((item) => item.name),
    };
  }

  const visionItems = visionMenu.map((item) => ({ key: normalizeMenuName(item.name), item }));
  let filled = 0;
  const merged = htmlItems.map((htmlItem) => {
    const match = findVisionMatch(htmlItem.name, visionItems);
    if (!match) return htmlItem;
    const price = htmlItem.price ?? visionPrice(match);
    const character = htmlItem.character ?? visionCharacter(match);
    if (price !== htmlItem.price || character !== htmlItem.character) filled++;
    return { ...htmlItem, price, character };
  });

  if (filled === 0) return current;
  changes.push(`メニュー: HTML の ${htmlItems.length} 品のうち ${filled} 品の空欄を Vision で埋めた`);
  return { メニュー詳細リスト: merged, 具体的なメニュー名リスト: current.具体的なメニュー名リスト };
}

export function mergeVisionIntoExtraction(
  extraction: ExtractionResult,
  vision: VisionExtraction,
  options: VisionMergeOptions
): VisionMergeResult {
  const changes: string[] = [];
  const menu = mergeMenu(extraction, vision.menuItems, changes);

  let グッズ名 = extraction.グッズ名;
  if (isEmptyList(グッズ名) && vision.goodsItems.length > 0) {
    グッズ名 = unique(vision.goodsItems.map((item) => item.name));
    changes.push(`グッズ名: HTML に無いため Vision の ${グッズ名.length} 件を使う`);
  }

  let ノベルティ名 = extraction.ノベルティ名;
  if (isEmptyList(ノベルティ名) && vision.noveltyItems.length > 0) {
    ノベルティ名 = unique(vision.noveltyItems.map((item) => item.name));
    changes.push(`ノベルティ名: HTML に無いため Vision の ${ノベルティ名.length} 件を使う`);
  }

  let キャラクター名 = extraction.キャラクター名;
  const visionCharacters = unique(
    [...vision.menuItems, ...vision.goodsItems, ...vision.noveltyItems].flatMap((item) => item.characterName)
  );
  if (visionCharacters.length > 0) {
    if (options.hasRedrawnIllustrations) {
      const combined = combineCharacters(visionCharacters, キャラクター名 ?? []);
      if (combined.length !== (キャラクター名?.length ?? 0)) {
        changes.push(`キャラクター名: 描き下ろしの記載があるため Vision と HTML を合わせた (${combined.length} 人)`);
        キャラクター名 = combined;
      }
    } else if (isEmptyList(キャラクター名)) {
      changes.push(`キャラクター名: HTML に無いため Vision の ${visionCharacters.length} 人を使う`);
      キャラクター名 = visionCharacters;
    }
  }

  if (changes.length === 0) return { extraction, changes };
  return {
    extraction: { ...extraction, ...menu, グッズ名, ノベルティ名, キャラクター名 },
    changes,
  };
}
