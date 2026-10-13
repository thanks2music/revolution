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
/** 末尾の副題 (「――旋風を、巻き起こせ――」「～風の女神～」)。区切りは ― / — の 1〜2 文字か、波線 */
const SUBTITLE = /\s*(?:[―—]{1,2}|[～〜~]).*$/;

/** 副題を外した形。外せない・外すと空になるときは null */
function withoutSubtitle(text: string): string | null {
  const base = text.replace(SUBTITLE, '').trim();
  return base && base !== text.trim() ? base : null;
}

/**
 * 代替テキストから作る照合キーの候補 (そのままの形 → 副題を外した形の順)。副題は接頭辞を外した形からだけ外す
 * (「0427～_後期_…」の ～ を副題の区切りと取り違えないため)
 */
export function altKeys(alt: string): string[] {
  const withoutPrefix = alt.replace(UNDERSCORE_PREFIX, '');
  const cleaned = [withoutPrefix, withoutPrefix.replace(LEADING_LATIN, '')];
  const subtitles = cleaned.map(withoutSubtitle).filter((text): text is string => text !== null);
  return [...new Set([alt, ...cleaned, ...subtitles].map(itemNameKey))].filter(Boolean);
}

/**
 * 画像を品目に振り分ける。byItem[i] は names[i] の画像 (元の順)。1 枚の画像は 1 品目にだけ付く
 * (同じキーの品目が複数あれば先の品目)。代替テキストが無い・照合できない画像は rest
 */
export function matchImagesToItems<T extends { alt: string | null }>(
  names: string[],
  images: T[]
): { byItem: T[][]; rest: T[] } {
  const indexByKey = new Map<string, number>();
  // そのままの形を先に全品目ぶん登録し、副題を外した形はその後 (同じキーの品目があればそちらが優先)
  const register = (key: string | null, index: number) => {
    if (key && !indexByKey.has(key)) indexByKey.set(key, index);
  };
  names.forEach((name, index) => register(itemNameKey(name), index));
  names.forEach((name, index) => {
    const base = withoutSubtitle(name);
    if (base) register(itemNameKey(base), index);
  });
  const byItem: T[][] = names.map(() => []);
  const rest: T[] = [];
  for (const image of images) {
    const index = image.alt ? altKeys(image.alt).map((key) => indexByKey.get(key)).find((i) => i !== undefined) : undefined;
    if (index === undefined) rest.push(image);
    else byItem[index].push(image);
  }
  return { byItem, rest };
}
