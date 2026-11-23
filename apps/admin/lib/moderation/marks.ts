import type { ModerationPhoto, PhotoDecision } from '@revolution/reviews/moderation';
import type { ReviewReportReason } from '@revolution/schemas/review-constants';

/**
 * 口コミの確認の写真の印 (Figma 14・F-11・F-12)。BOSS が写真ごとに「非公開」と理由を決める。
 * 初めの値は AI の判断 (写真の非公開の理由が入っている写真は、AI が非公開を勧めた)
 */

export type PhotoMark = {
  id: number;
  /** 並びの番号 (1 から。画面の「写真 3」) */
  number: number;
  hide: boolean;
  /** 写真の非公開の理由 (通報の 8 つ。審査の 4 種を含む) */
  reason: ReviewReportReason | null;
  /** AI が非公開を勧めた写真 (印「AI」を出す) */
  byAi: boolean;
};

export function initialMarks(photos: ModerationPhoto[]): PhotoMark[] {
  return photos.map((photo, index) => ({
    id: photo.id,
    number: index + 1,
    hide: photo.hiddenReason !== null,
    reason: photo.hiddenReason,
    byAi: photo.hiddenReason !== null,
  }));
}

/** 非公開にしたのに理由を選んでいない写真の番号 */
function marksMissingReason(marks: PhotoMark[]): number[] {
  return marks.filter(mark => mark.hide && !mark.reason).map(mark => mark.number);
}

/** 公開のボタンの言葉 (例: 「写真 3・5 を非公開にして公開」/「公開する」) */
export function publishLabel(marks: PhotoMark[]): string {
  const hidden = marks.filter(mark => mark.hide).map(mark => mark.number);
  return hidden.length > 0 ? `写真 ${hidden.join('・')} を非公開にして公開` : '公開する';
}

/** 理由が足りない時の知らせ (例: 「写真 5 の理由を選んでください」) */
export function missingReasonMessage(marks: PhotoMark[]): string | null {
  const missing = marksMissingReason(marks);
  return missing.length > 0 ? `写真 ${missing.join('・')} の理由を選んでください` : null;
}

/**
 * サーバーに送る形。公開の時は、理由の無い非公開があれば null (送らない)。
 * 差し戻しの時は写真を配信しないので、理由の無い非公開は「非公開にしない」として送る
 * (差し戻した口コミの写真は、どの印でも公開されない)
 */
export function toPhotoDecisions(
  marks: PhotoMark[],
  mode: 'publish' | 'reject'
): PhotoDecision[] | null {
  if (mode === 'publish' && marksMissingReason(marks).length > 0) return null;
  return marks.map(mark =>
    mark.hide && mark.reason
      ? { id: mark.id, hide: true, reason: mark.reason }
      : { id: mark.id, hide: false }
  );
}
