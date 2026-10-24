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
/** 取り出す表記の数の上限 (プロンプトを膨らませない) */
const MAX_NOTICES = 5;

/** 圧縮前の HTML から、重複を除いた著作権表記 (「©堀越耕平／集英社・僕のヒーローアカデミア製作委員会」の形) */
export function extractCopyrightNotices(rawHtml: string): string[] {
  const notices: string[] = [];
  for (const match of rawHtml.matchAll(COPYRIGHT)) {
    const body = match[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    // 数字だけ (© 2026) や記号だけの表記は名前を持たない
    if (!/[^\d\s.,\-–—/／]/.test(body)) continue;
    const notice = `©${body}`;
    if (!notices.includes(notice)) notices.push(notice);
    if (notices.length >= MAX_NOTICES) break;
  }
  return notices;
}

/** 照合用に、空白と敬称 (先生・さん・氏) を落とし、NFKC にそろえる */
function authorKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/(?:先生|さん|氏)$/, '')
    .replace(/[\s・･]/g, '');
}

function evidenceKey(text: string): string {
  return text.normalize('NFKC').replace(/[\s・･]/g, '');
}

export interface SupportedAuthors {
  /** 根拠のある名前だけを残した原作者名 (残らなければ null) */
  原作者名: string | string[] | null;
  /** 根拠が無いので外した名前 */
  dropped: string[];
}

/**
 * 原作者名のうち、著作権表記かページの本文に出てくるものだけを残す (推測で埋めない)。
 * 照合は敬称と空白を無視する (「堀越耕平先生」と「©堀越 耕平／集英社」は一致する)
 */
export function keepSupportedAuthors(
  原作者名: string | string[] | null | undefined,
  evidence: readonly string[]
): SupportedAuthors {
  if (原作者名 === null || 原作者名 === undefined) return { 原作者名: null, dropped: [] };
  const names = Array.isArray(原作者名) ? 原作者名 : [原作者名];
  const haystack = evidence.map(evidenceKey).join('\n');
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of names) {
    const key = authorKey(name);
    if (key && haystack.includes(key)) kept.push(name);
    else dropped.push(name);
  }
  const result = kept.length === 0 ? null : Array.isArray(原作者名) ? kept : kept[0];
  return { 原作者名: result, dropped };
}
