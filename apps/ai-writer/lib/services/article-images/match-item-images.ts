/**
 * 公式のページの画像を、代替テキストと品名で品目に対応づける (2026-10-13 BOSS 決定)
 *
 * LTR などのサイトは、メニューやグッズの画像の代替テキストに品名を書いている。代替テキストには
 * 「2枚目_」「後期_」「0427～_」のような接頭辞や、「badge缶バッジ…」のような英字の前置きが付くことがあるので、
 * それを外した形でも照合する。照合は表記の揺れと末尾の種類数の注記を無視する (`itemNameKey`)。
 *
 * 品名と代替テキストの片方にだけ副題が付くこと (「天使VS堕天使ドリンク――振り落とされるなよ、少年――」と
 * 「天使VS堕天使ドリンク」) があるので、末尾の副題を外した形でも照合する (2026-10-13 BOSS 決定)。
 * そのままの形で一致する品目があれば、そちらを優先する。
 *
 * 推測で結びつけない: 照合できない画像は、どの品目にも付けず rest に残す (呼び出し側が節の末尾に並べる)。
 */
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';

/** 「2枚目_」「後期_」「0427～_」など、最後の _ までの接頭辞 */
const UNDERSCORE_PREFIX = /^.*_/;
/** 品名の前に付いた英字 (「badge缶バッジ」の badge) */
const LEADING_LATIN = /^[a-z]+(?=[^\x00-\x7f])/i;
/**
 * 末尾の副題。区切りで囲まれ、文字列の末尾にあるものだけ (「――旋風を、巻き起こせ――」「～風の女神～」)。
 * 途中の「炭治郎～水の呼吸～パフェ」は副題ではなく品名の一部として扱う
 */
const SUBTITLE = /\s*(?:[―—]{1,2}[^―—]+[―—]{1,2}|[～〜~][^～〜~]+[～〜~])\s*$/;

/** 副題を外した形。外せない・外すと空になるときは null */
function withoutSubtitle(text: string): string | null {
  const base = text.replace(SUBTITLE, '').trim();
  return base && base !== text.trim() ? base : null;
}

/** 「2枚目_」などの接頭辞と品名の前の英字を外した形 (元の形も含む) */
function cleanedAlts(alt: string): string[] {
  const withoutPrefix = alt.replace(UNDERSCORE_PREFIX, '');
  return [alt, withoutPrefix, withoutPrefix.replace(LEADING_LATIN, '')];
}

/** 代替テキストから作る照合キーの候補 (副題は外さない形) */
export function altKeys(alt: string): string[] {
  return [...new Set(cleanedAlts(alt).map(itemNameKey))].filter(Boolean);
}

/**
 * 代替テキストの副題を外した照合キー。副題は接頭辞を外した形からだけ外す
 * (「0427～_後期_…」の ～ を副題の区切りと取り違えないため)
 */
function altBaseKeys(alt: string): string[] {
  const bases = cleanedAlts(alt)
    .slice(1)
    .map(withoutSubtitle)
    .filter((text): text is string => text !== null);
  return [...new Set(bases.map(itemNameKey))].filter(Boolean);
}

/**
 * 画像を品目に振り分ける。byItem[i] は names[i] の画像 (元の順)。1 枚の画像は 1 品目にだけ付く
 * (同じキーの品目が複数あれば先の品目)。代替テキストが無い・照合できない画像は rest。
 *
 * 照合の順: (1) そのままの形どうし → (2) 代替テキスト (副題なし) と、品名の副題を外した形 →
 * (3) 代替テキストの副題を外した形と、品名 (そのままの形)。副題は片方にだけ付く場合しか外さない
 * (両方に別の副題があれば別の品目)。副題を外した形が複数の品目で同じなら、その形では結びつけない
 */
export function matchImagesToItems<T extends { alt: string | null }>(
  names: readonly string[],
  images: readonly T[]
): { byItem: T[][]; rest: T[] } {
  const exact = new Map<string, number>();
  names.forEach((name, index) => {
    const key = itemNameKey(name);
    if (key && !exact.has(key)) exact.set(key, index);
  });
  const base = new Map<string, number | null>();
  names.forEach((name, index) => {
    const stripped = withoutSubtitle(name);
    const key = stripped ? itemNameKey(stripped) : '';
    if (!key) return;
    base.set(key, base.has(key) ? null : index); // 2 品目以上で同じなら null (使わない)
  });

  const byItem: T[][] = names.map(() => []);
  const rest: T[] = [];
  for (const image of images) {
    const index = image.alt ? findIndex(image.alt, exact, base) : undefined;
    if (index === undefined) rest.push(image);
    else byItem[index].push(image);
  }
  return { byItem, rest };
}

function findIndex(alt: string, exact: Map<string, number>, base: Map<string, number | null>): number | undefined {
  const keys = altKeys(alt);
  for (const key of keys) if (exact.has(key)) return exact.get(key);
  for (const key of keys) {
    const index = base.get(key);
    if (index !== undefined && index !== null) return index;
  }
  for (const key of altBaseKeys(alt)) if (exact.has(key)) return exact.get(key);
  return undefined;
}
