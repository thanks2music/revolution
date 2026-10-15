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

/** 文の区切りにするブロックのタグ (インラインのタグ (strong・a・span など) は区切らずに外す) */
const BLOCK_TAG = /<\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|br|tr|td|th|table|section|article|header|footer|figure|figcaption)\b[^>]*>/gi;
const SENTENCE_BREAK = /[。！!？?\n]/;

/** 「グッズ」を含む文 (ブロックのタグと句点・感嘆符・疑問符・改行で区切る) から見つかった語。無ければ null */
export function redrawnWordInGoodsSentences(html: string | null | undefined): RedrawnWord | null {
  const sentences = (html ?? '')
    .replace(BLOCK_TAG, '\n')
    .replace(/<[^>]*>/g, '')
    .split(SENTENCE_BREAK)
    .filter((sentence) => sentence.includes('グッズ'));
  return redrawnIllustrationWord(sentences);
}

/** 1 ページの本文ブロックから調べた語 (`category-image-extractor` が切り詰める前の本文で記録する) */
export interface PageRedrawnWords {
  /** ページ全体で最初に見つかった語 */
  page: RedrawnWord | null;
  /** グッズの文脈の語。グッズのページはページ全体の語、それ以外は「グッズ」を含む文の語 */
  goods: RedrawnWord | null;
}

/** 1 ページの本文ブロックの語を調べる (グッズのページかどうかで、グッズの文脈の語の取り方を変える) */
export function pageRedrawnWords(html: string | null | undefined, isGoodsPage: boolean): PageRedrawnWords {
  const page = redrawnIllustrationWord([html]);
  if (page === null) return { page, goods: null };
  return { page, goods: isGoodsPage ? page : redrawnWordInGoodsSentences(html) };
}

/** 記事で使う 2 つの語 */
export interface RedrawnWords {
  /** ページ全体の語 (この記事のポイントの「〇〇イラストを使用」の行) */
  page: RedrawnWord | null;
  /** グッズの文脈の語 (リード文・本文の「〇〇イラストを使用したグッズ」) */
  goods: RedrawnWord | null;
}

/**
 * 記事で使う語を決める (2026-10-15 BOSS 決定)。どちらの語も無ければ、記事はイラストの種類に触れない。
 * ページ全体の語をグッズに結び付けると、ノベルティだけが描き下ろしのイベントで「グッズに描き下ろし」と書いてしまうため、
 * グッズの文脈の語は別に取る。順は (1) グッズのページとグッズ名 (2) トップ・ほかのページの「グッズ」を含む文
 *
 * @param officialHtml トップの本文ブロック (detail-extraction の `selectMainContent` で切り出したもの)
 * @param subpages 下層・会場のページごとに記録した語 (切り詰める前の本文で調べたもの)
 */
export function deriveRedrawnWords(input: {
  officialHtml: string | null | undefined;
  subpages: ReadonlyArray<{ kind: string; redrawn: PageRedrawnWords }>;
  goodsNames: ReadonlyArray<string>;
}): RedrawnWords {
  const top = pageRedrawnWords(input.officialHtml, false);
  const goodsPages = input.subpages.filter((page) => page.kind === 'goods');
  const otherPages = input.subpages.filter((page) => page.kind !== 'goods');
  return {
    page: top.page ?? input.subpages.find((page) => page.redrawn.page !== null)?.redrawn.page ?? null,
    goods:
      goodsPages.find((page) => page.redrawn.goods !== null)?.redrawn.goods ??
      redrawnIllustrationWord(input.goodsNames) ??
      top.goods ??
      otherPages.find((page) => page.redrawn.goods !== null)?.redrawn.goods ??
      null,
  };
}
