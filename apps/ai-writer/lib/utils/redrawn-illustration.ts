/**
 * 公式ページに「描き下ろし」「描き起こし」の記載があるかを調べる (Layer 1)。
 *
 * キャラクター名を Vision と HTML で足し合わせるかの判定に使う (2026-10-11 の方針)。
 * ナビやフッター、関連ニュースの欄に別企画の「描き下ろし」があっても当たらないよう、
 * 呼び出し側は本文ブロックだけを渡す (`officialHtml` / `selectMainContent`)。
 */
const REDRAWN_ILLUSTRATION_PATTERN = /描き下ろし|描きおろし|描き起こし|描きおこし/;

/** 「描き下ろし」「描き起こし」(ひらがな表記を含む) の記載があるか。 */
export function mentionsRedrawnIllustration(html: string | null | undefined): boolean {
  return !!html && REDRAWN_ILLUSTRATION_PATTERN.test(html);
}

/** 記事に書く語 (ひらがなの表記は漢字の表記にそろえる) */
export type RedrawnWord = '描き下ろし' | '描き起こし';

/**
 * 最初に見つかった語 (「この記事のポイント」の行に書く、2026-10-15)。テキストを順に見て、無ければ null。
 * 公式が「描き起こし」と書いているのに「描き下ろし」と書かないよう、見つかった語をそのまま使う
 */
export function redrawnIllustrationWord(texts: ReadonlyArray<string | null | undefined>): RedrawnWord | null {
  for (const text of texts) {
    const match = text?.match(REDRAWN_ILLUSTRATION_PATTERN);
    if (match) return /起こし|おこし/.test(match[0]) ? '描き起こし' : '描き下ろし';
  }
  return null;
}
