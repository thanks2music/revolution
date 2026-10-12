/**
 * Vision の生の応答 (JSON.parse の結果) を型付きの結果にそろえる (Layer 1)。
 *
 * openai / anthropic / google の 3 社で、値が無いときの書き方 (`null`・`"null"`・
 * `"true"`・文字列の数値) がばらばらだった。変換を 1 か所にまとめ、どの社で実行しても
 * 同じ形と同じ確信度になるようにする (2026-10-11 の方針)。
 *
 * - name が空の品目は捨てる
 * - 文字列の `"null"` や空文字は「値なし」
 * - 真偽値は `true` / `"true"` だけを真とする
 * - 数値は number か「数字とカンマだけの文字列」だけを受け付ける
 * - 品目の confidence は 0〜1 の数値 (数値の文字列 `"0.92"` を含む) だけを受け付ける (それ以外は値なし)
 * - 全体の confidence は、confidence のある品目の平均。品目が 0、または confidence の
 *   ある品目が 0 なら 0 (レベル A にしない)。応答の最上位の confidence は使わない
 * - 同じ品目 (品名・キャラクター・価格が同じ) は 1 つにする。縦に長い画像は重ねて分割して渡すため
 *   (`prepare-vision-images.ts`)、境目の品目が 2 回返る
 */
import type { TokenUsage } from '@revolution/schemas/ai-provider-response';
import {
  VisionExtractionResultSchema,
  type GoodsItem,
  type MenuItem,
  type NoveltyItem,
  type PriceTaxType,
  type VisionExtractionResult,
} from '@revolution/schemas/vision-api-extraction';
import type { VisionProvider } from '@/lib/types/vision-api';
import {
  isRecord,
  toBoolean,
  toOptionalNumber,
  toOptionalString,
  type RawRecord,
} from '@/lib/utils/llm-values';
import { normalizeMenuName } from './merge-vision-into-extraction';

export interface NormalizeVisionContext {
  provider: VisionProvider;
  totalImagesAnalyzed: number;
  tokensUsed?: TokenUsage;
}

/**
 * 0〜1 の数値だけを確信度として受け付ける。価格と違って小数なので、`"0.92"` のような
 * 数値の文字列も受け付ける (値なしにすると全体の確信度が 0 に落ち、正しい抽出を捨てるため)。
 */
function toConfidence(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** 税込・税抜の表記。`included` / `excluded` と、日本語の「税込」「税抜」を受け付ける。 */
export function toPriceTaxType(value: unknown): PriceTaxType | undefined {
  const s = toOptionalString(value);
  if (!s) return undefined;
  if (s === 'included' || s.includes('税込')) return 'included';
  if (s === 'excluded' || s.includes('税抜') || s.includes('税別')) return 'excluded';
  return undefined;
}

/**
 * キャラクター名の装飾を落とす。
 * 例: "場地（制服ver）" → "場地"、"千冬★" → "千冬"
 */
export function cleanCharacterName(name: string): string {
  return name
    .replace(/[★☆♪♡【】]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();
}

/** キャラクター名は配列だけを受け付ける (文字列は形の崩れとして捨てる)。 */
function toCharacterNames(value: unknown, itemName: string, provider: VisionProvider): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? cleanCharacterName(v) : ''))
      .filter((v) => v.length > 0);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    console.warn(
      `[normalizeVisionResponse] ${provider}: characterName が配列ではなく文字列 ("${value}")。品目 "${itemName}" のキャラクター名は空として扱う`
    );
  }
  return [];
}

/** 同じ品目かを見分けるキー。表記の揺れ (全角・半角、空白、記号) は無視する */
function itemKey(item: { name: string; characterName: string[]; price?: number }): string {
  const characters = item.characterName.map(normalizeMenuName).sort().join(',');
  return `${normalizeMenuName(item.name)}|${characters}|${item.price ?? ''}`;
}

function toItems<T extends { name: string; characterName: string[]; price?: number }>(
  value: unknown,
  convert: (raw: RawRecord, name: string) => T
): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const name = toOptionalString(raw.name);
    if (!name) continue;
    const item = convert(raw, name);
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

/**
 * 品目の confidence の平均。値の無い品目は除く。数える品目が 0 なら 0。
 * `mergeVisionResults` もカテゴリをまとめた後の確信度にこれを使う。
 */
export function averageItemConfidence(items: Array<{ confidence?: number }>): number {
  const values = items
    .map((item) => item.confidence)
    .filter((c): c is number => typeof c === 'number');
  if (values.length === 0) return 0;
  return values.reduce((sum, c) => sum + c, 0) / values.length;
}

/**
 * Vision の生の応答を、3 社共通の型付きの結果にする。
 *
 * @throws {ZodError} 変換後の結果が `VisionExtractionResultSchema` に合わないとき
 *   (変換の不具合。呼び出し側はリトライしない)
 */
export function normalizeVisionResponse(
  raw: unknown,
  context: NormalizeVisionContext
): VisionExtractionResult {
  const { provider } = context;
  const root: RawRecord = isRecord(raw) ? raw : {};

  const menuItems: MenuItem[] = toItems(root.menuItems, (item, name) => ({
    name,
    price: toOptionalNumber(item.price),
    priceTaxType: toPriceTaxType(item.priceTaxType),
    characterName: toCharacterNames(item.characterName, name, provider),
    hasNovelty: toBoolean(item.hasNovelty),
    noveltyCondition: toOptionalString(item.noveltyCondition),
    bonus: toOptionalString(item.bonus),
    description: toOptionalString(item.description),
    notes: toOptionalString(item.notes),
    remarks: toOptionalString(item.remarks),
    confidence: toConfidence(item.confidence),
  }));

  const goodsItems: GoodsItem[] = toItems(root.goodsItems, (item, name) => ({
    name,
    price: toOptionalNumber(item.price),
    priceTaxType: toPriceTaxType(item.priceTaxType),
    variantCount: toOptionalNumber(item.variantCount),
    variantDetails: toOptionalString(item.variantDetails),
    characterName: toCharacterNames(item.characterName, name, provider),
    isRandomSale: toBoolean(item.isRandomSale),
    confidence: toConfidence(item.confidence),
  }));

  const noveltyItems: NoveltyItem[] = toItems(root.noveltyItems, (item, name) => ({
    name,
    condition: toOptionalString(item.condition),
    variantCount: toOptionalNumber(item.variantCount),
    characterName: toCharacterNames(item.characterName, name, provider),
    isRandom: toBoolean(item.isRandom),
    confidence: toConfidence(item.confidence),
    notes: toOptionalString(item.notes),
    remarks: toOptionalString(item.remarks),
  }));

  const metadata = isRecord(root.metadata) ? root.metadata : {};

  return VisionExtractionResultSchema.parse({
    visionExtraction: {
      confidence: averageItemConfidence([...menuItems, ...goodsItems, ...noveltyItems]),
      provider,
      timestamp: new Date().toISOString(),
      menuItems,
      goodsItems,
      noveltyItems,
      metadata: {
        hasComingSoonNotice: toBoolean(metadata.hasComingSoonNotice),
        totalImagesAnalyzed: context.totalImagesAnalyzed,
        ...(context.tokensUsed ? { tokensUsed: context.tokensUsed } : {}),
      },
    },
  });
}
