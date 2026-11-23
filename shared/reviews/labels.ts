import {
  REVIEW_REPORT_REASONS,
  REVIEW_SCREENING_REASONS,
  type ReviewAttendance,
  type ReviewFoodCostBand,
  type ReviewGoodsCostBand,
  type ReviewReasonCode,
  type ReviewReportReason,
  type ReviewScreeningReason,
} from '@revolution/schemas/review-constants';

/**
 * 口コミの画面に出す言葉 (Figma #7 / #3)。値の一覧は `shared/schemas/review-constants.ts` が正本で、
 * ここは画面の言葉だけを持つ (DB の CHECK と二段で固定した値を、表示の都合で増やさない)。
 */

/**
 * 星の数ごとの満足度の言葉。4 つ星の「満足した」は Figma #7、ほかは 2026-11-22 に BOSS が確定した
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
 * 差し戻し・非公開の理由。投稿者本人にだけ見せる (投稿ガイドラインの言葉に合わせる)。
 * 最初の 4 つは審査の 4 種、残りは BOSS が通報を受けて非公開にする時の理由 (one-more-time #168)
 */
export const REVIEW_REASON_LABELS: Record<ReviewReportReason, string> = {
  personal_info: '個人情報やほかの人を特定できる内容が含まれています',
  abuse: '誹謗中傷・差別・性的な表現が含まれています',
  spam: '宣伝や、この開催と関係のない内容が含まれています',
  resale: 'グッズの譲渡・交換・転売の呼びかけが含まれています',
  spoiler_unmarked: 'ネタバレを含むのに、ネタバレの印が付いていません',
  photo_reposted: 'ほかの人が撮った写真や画像を、許可なく載せています',
  not_attended: '実際にこの開催に行った方の口コミと確認できませんでした',
  other: '投稿ガイドラインに沿っていない内容が含まれています',
};

/** 通報の理由 (仕様 #156 の言葉)。通報のダイアログと、管理アプリの通報の一覧に出す */
export const REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  personal_info: '個人情報・他人の顔',
  abuse: '誹謗中傷・差別・性的表現',
  spam: '宣伝・スパム・開催と無関係',
  resale: 'グッズの譲渡・転売の呼びかけ',
  spoiler_unmarked: 'ネタバレなのに印が無い',
  photo_reposted: '写真の無断転載',
  not_attended: '行っていない人の口コミ',
  other: 'その他',
};

/** 訪問した年月 (YYYY-MM) を「2026年7月」の形にする */
export function formatVisitedMonth(visitedMonth: string): string {
  const [year, month] = visitedMonth.split('-');
  return `${year}年${Number(month)}月`;
}

/**
 * 理由のコードのうち、投稿者に言葉で見せるもの (審査の 4 種と通報で足した 4 種)。ai_failure は null。
 * マイページと開催のページの本人の欄の両方が使う
 */
export function toExplainedReason(code: ReviewReasonCode | null): ReviewReportReason | null {
  return REVIEW_REPORT_REASONS.find(reason => reason === code) ?? null;
}

/** 理由のコードのうち、審査の 4 種だけ (管理アプリの確認待ちの差し戻しは、この 4 つから選ぶ)。ほかは null */
export function toScreeningReason(code: ReviewReasonCode | null): ReviewScreeningReason | null {
  return REVIEW_SCREENING_REASONS.find(reason => reason === code) ?? null;
}

/** 「行った人のデータ」の棒グラフに出す短い言葉 (Figma #3 `83:103`) */
export const ATTENDANCE_SHORT_LABELS: Record<ReviewAttendance, string> = {
  walk_in: '並ばずそのまま',
  reservation: '事前予約',
  queue: '整理券・当日の列',
  lottery: '抽選に当選',
  other: 'その他',
};

/**
 * 「〜人が最多」に続ける言葉 (Figma #3 `83:106`)。「その他」だけは「その他人」と読めてしまうので言い換える
 * (投稿の画面の選択肢は短い「その他」のまま)
 */
export const ATTENDANCE_SUMMARY_LABELS: Record<ReviewAttendance, string> = {
  ...ATTENDANCE_LABELS,
  other: 'その他の方法で入った',
};
