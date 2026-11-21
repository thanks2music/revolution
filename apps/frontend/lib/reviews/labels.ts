import type {
  ReviewAttendance,
  ReviewFoodCostBand,
  ReviewGoodsCostBand,
} from '@revolution/schemas/review';

/**
 * 口コミの画面に出す言葉 (Figma #7 / #3)。値の一覧は `shared/schemas/review.ts` が正本で、
 * ここは画面の言葉だけを持つ (DB の CHECK と二段で固定した値を、表示の都合で増やさない)。
 */

/**
 * 星の数ごとの満足度の言葉。Figma #7 には 4 つ星の「満足した」だけがあり、ほかは仮置き
 * (BOSS の確認待ち。one-more-time #161 の PR③ の本文に書いた)
 */
export const RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '不満だった',
  2: 'いまひとつ',
  3: 'ふつう',
  4: '満足した',
  5: 'とても満足した',
};

export const ATTENDANCE_LABELS: Record<ReviewAttendance, string> = {
  walk_in: '並ばずそのまま入った',
  reservation: '事前予約して入った',
  queue: '整理券・当日の列に並んで入った',
  lottery: '抽選に当選して入った',
  other: 'その他',
};

export const FOOD_COST_BAND_LABELS: Record<ReviewFoodCostBand, string> = {
  none: 'なし',
  under_2000: '〜¥2,000',
  '2000_3000': '¥2,000〜3,000',
  '3000_5000': '¥3,000〜5,000',
  over_5000: '¥5,000〜',
};

export const GOODS_COST_BAND_LABELS: Record<ReviewGoodsCostBand, string> = {
  none: '買わなかった',
  under_5000: '〜¥5,000',
  '5000_10000': '¥5,000〜10,000',
  '10000_30000': '¥10,000〜30,000',
  over_30000: '¥30,000〜',
};

/**
 * X (旧 Twitter) の共有の URL。本文は口コミの中身を含めない (審査の前の文を外に出さない)
 * https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent
 */
export function buildXShareUrl(input: {
  eventName: string;
  venueName: string;
  siteName: string;
  pageUrl: string;
}): string {
  const text = `${input.eventName} ${input.venueName} の口コミを書きました｜${input.siteName}`;
  const params = new URLSearchParams({ text, url: input.pageUrl });
  return `https://x.com/intent/post?${params.toString()}`;
}
