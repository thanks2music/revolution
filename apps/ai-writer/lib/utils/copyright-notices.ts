/**
 * 公式サイトの著作権表記 (©) を読み、原作者名の根拠にする (Layer 1、2026-10-24 BOSS 決定)
 *
 * 抽出の LLM に渡すのは本文の主要部分 (`extractContentHtml` の compacted) だけで、著作権表記は届いていなかった。
 * ヒロアカは JavaScript の文字列 (`const newText = '©堀越耕平／集英社・…'`)、コナンはフッターの `<address>` にある。
 * それでも記事に原作者名が入った回は、LLM が自分の知識で補っていた (推測で埋めない、の方針に反する)。
 *
 * - `extractCopyrightNotices`: 圧縮前の HTML から © の表記を取り出す (抽出のプロンプトに渡す)
 * - `keepSupportedAuthors`: 抽出した原作者名のうち、著作権表記かページの本文に出てくる名前だけを残す
 */

/** © (文字・実体参照・JS のエスケープ) の後ろ、タグ・引用符・改行の手前まで */
const COPYRIGHT = /(?:©|&copy;|&#169;|&#xa9;|\\u00a9)\s*([^<>'"`\n\r\\]{2,120})/gi;
/** 表記に残りやすい実体参照を文字に戻す */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** 取り出す表記の数の上限 (プロンプトを膨らませない) */
const MAX_NOTICES = 5;
/** 権利者を区切る「／」「/」を含む表記 (「©作者／出版社」の形。作品の著作権表記らしいもの) */
const HOLDER_SEPARATOR = /[/／]/;

/**
 * 圧縮前の HTML から、重複を除いた著作権表記 (「©堀越耕平／集英社・僕のヒーローアカデミア製作委員会」の形)。
 * 全件を集めてから、権利者の区切りを含む表記を先に並べて 5 件に絞る (ヘッダーや埋め込みの © が多くても、
 * フッターにある作品の表記を落とさない)
 */
export function extractCopyrightNotices(rawHtml: string): string[] {
  const notices: string[] = [];
  for (const match of rawHtml.matchAll(COPYRIGHT)) {
    const body = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
    // 数字だけ (© 2026) や記号だけの表記は名前を持たない
    if (!/[^\d\s.,\-–—/／]/.test(body)) continue;
    const notice = `©${body}`;
    if (!notices.includes(notice)) notices.push(notice);
  }
  const rank = (notice: string) => (HOLDER_SEPARATOR.test(notice) ? 0 : 1);
  return notices
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => rank(a.notice) - rank(b.notice) || a.index - b.index)
    .slice(0, MAX_NOTICES)
    .map(({ notice }) => notice);
}

/** 照合用に、NFKC と小文字にそろえ、空白と中黒を落とす */
function evidenceKey(text: string): string {
  return text.normalize('NFKC').replace(/[\s・･]/g, '').toLowerCase();
}

/** 原作者名の照合用のキー (敬称の 先生・監督・さん・氏 を落とす) */
function authorKey(name: string): string {
  return evidenceKey(name.normalize('NFKC').replace(/\s*(?:先生|監督|さん|氏)$/, ''));
}

/** 本文の HTML のタグを外す (タグをまたいだ名前「<span>尾田</span><span>栄一郎</span>」も照合できるように、属性の値でも当てないように) */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** これより短い名前は、本文のたまたまの一致を避けるため、著作権表記の中だけで照合する */
const MIN_PAGE_MATCH_LENGTH = 3;

export interface SupportedAuthors {
  /** 根拠のある名前だけを残した原作者名 (残らなければ null) */
  原作者名: string | string[] | null;
  /** 根拠が無いので外した名前 */
  dropped: string[];
}

/**
 * 原作者名のうち、著作権表記かページの本文に出てくるものだけを残す (推測で埋めない)。
 * 照合は敬称・空白・大文字小文字を無視する (「堀越耕平先生」と「©堀越 耕平／集英社」は一致する)。
 * 3 文字未満の名前は、著作権表記の中だけで照合する
 */
export function keepSupportedAuthors(
  原作者名: string | string[] | null | undefined,
  evidence: { notices: readonly string[]; pageText: string }
): SupportedAuthors {
  if (原作者名 === null || 原作者名 === undefined) return { 原作者名: null, dropped: [] };
  const names = Array.isArray(原作者名) ? 原作者名 : [原作者名];
  const notices = evidence.notices.map(evidenceKey).join('\n');
  const page = evidenceKey(stripTags(evidence.pageText));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of names) {
    const key = authorKey(name);
    const supported =
      key.length > 0 && (notices.includes(key) || (key.length >= MIN_PAGE_MATCH_LENGTH && page.includes(key)));
    if (supported) kept.push(name);
    else dropped.push(name);
  }
  const result = kept.length === 0 ? null : Array.isArray(原作者名) ? kept : kept[0];
  return { 原作者名: result, dropped };
}

/**
 * 抽出の結果の原作者名を、根拠のある名前だけにする。外した名前があれば新しい結果を返し、
 * 名前が 1 つも残らなければ `原作者有無` も false にする (外した名前が無ければ元の結果のまま)
 */
export function applySupportedAuthors<T extends { 原作者名: string | string[] | null; 原作者有無: boolean }>(
  extraction: T,
  evidence: { notices: readonly string[]; pageText: string }
): { extraction: T; dropped: string[] } {
  const authors = keepSupportedAuthors(extraction.原作者名, evidence);
  if (authors.dropped.length === 0) return { extraction, dropped: [] };
  return {
    extraction: { ...extraction, 原作者名: authors.原作者名, 原作者有無: authors.原作者名 !== null },
    dropped: authors.dropped,
  };
}
