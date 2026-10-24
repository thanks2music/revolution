/**
 * 代替テキストが品名でない画像に、取得したページの本文から品名を当てる (2026-10-24 BOSS 決定)
 *
 * LTR のノベルティの画像は、代替テキストが配布条件の見出し (「ドリンク特典」「物販購入特典」) で、品名を含まない。
 * そのため品名との照合 (`matchImagesToItems`) が 1 件も成立せず、ノベルティ名の見出しが空のまま、画像がすべて
 * 「その他参考画像」に回っていた (ヒロアカ、revolution #387)。
 *
 * ページの本文 (`compactHtmlForLlm` の出力。画像は `[画像: 代替テキスト]`) では、見出しと品名が同じ段落に並ぶ:
 *
 *   <p><span>ドリンク特典</span>…「オリジナルコースター（全7種）」を1品につき1枚プレゼント！</p>
 *   [画像: ドリンク特典]
 *
 * 本文で代替テキストを探し、そこから次の画像 (`[画像: …]`) までに出てくる品名が 1 つだけなら、その品名を当てる。
 * 推測で結びつけない: 品名が 0 個か 2 個以上なら当てない (呼び出し側で「その他参考画像」に回る)。
 */
import { altKeys } from './match-item-images';
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { normalizeMenuName } from '@/lib/services/vision-api/merge-vision-into-extraction';

/** `compactHtmlForLlm` が画像を畳んだ印の頭 */
const IMAGE_MARKER = '[画像: ';
/** 代替テキストの後ろを見る長さの上限 (段落 1 つ分) */
const SEGMENT_LIMIT = 500;

/** 代替テキストの出現 (画像の印の中は除く) ごとに、その後ろから次の画像の印までの文字 */
function segmentsAfter(alt: string, text: string): string[] {
  const segments: string[] = [];
  for (let at = text.indexOf(alt); at !== -1; at = text.indexOf(alt, at + alt.length)) {
    if (text.slice(Math.max(0, at - IMAGE_MARKER.length), at) === IMAGE_MARKER) continue;
    const start = at + alt.length;
    const nextImage = text.indexOf(IMAGE_MARKER, start);
    segments.push(text.slice(start, Math.min(nextImage === -1 ? text.length : nextImage, start + SEGMENT_LIMIT)));
  }
  return segments;
}

/**
 * 文字の中に出てくる品名。ほかの候補の名前に含まれる短い名前は除く (「ステッカー」と「ホログラムステッカー」が
 * 両方当たれば、長いほう)
 */
function namesIn(segment: string, names: readonly string[]): string[] {
  const normalized = normalizeMenuName(segment);
  const found = names.filter((name) => {
    const key = itemNameKey(name);
    return key.length > 0 && normalized.includes(key);
  });
  return found.filter((name) => {
    const key = itemNameKey(name);
    return !found.some((other) => other !== name && itemNameKey(other).includes(key) && itemNameKey(other) !== key);
  });
}

/** 代替テキストに当てる品名 (当てられなければ null) */
export function nameFromPageText(alt: string, names: readonly string[], texts: readonly string[]): string | null {
  if (!alt.trim()) return null;
  const found = new Set(texts.flatMap((text) => segmentsAfter(alt, text).flatMap((segment) => namesIn(segment, names))));
  return found.size === 1 ? [...found][0] : null;
}

/**
 * 代替テキストが品名と照合できない画像の代替テキストを、本文から当てた品名に置き換える
 * (置き換えた画像の数も返す)。もともと品名と照合できる画像はそのまま
 */
export function withNamesFromPageText<T extends { alt: string | null }>(
  names: readonly string[],
  images: readonly T[],
  texts: readonly string[]
): { images: T[]; named: number } {
  const nameKeys = new Set(names.map(itemNameKey).filter(Boolean));
  let named = 0;
  const result = images.map((image) => {
    if (!image.alt || altKeys(image.alt).some((key) => nameKeys.has(key))) return image;
    const name = nameFromPageText(image.alt, names, texts);
    if (!name) return image;
    named++;
    return { ...image, alt: name };
  });
  return { images: result, named };
}
