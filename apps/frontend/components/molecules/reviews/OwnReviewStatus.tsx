'use client';

import { useEffect, useState } from 'react';

import { getOwnReviewState, type OwnReviewState } from '@/actions/review';
import { useAuthNav } from '@/components/molecules/AuthNavProvider';
import { toDotDate } from '@/lib/date';
import { REVIEW_REASON_LABELS } from '@revolution/reviews/labels';

/**
 * 本人の口コミの状態 (開催のページの島)。マウント後に Server Action で取る (LikeButton と同じく、
 * cookie に依る表示を静的な描画から切り離す)。会員でない・口コミが無い時は何も出さない。
 */
export function OwnReviewStatus({ occurrenceId }: { occurrenceId: number }) {
  const [state, setState] = useState<OwnReviewState | null>(null);
  // ログインしていない人には口コミが無いので、問い合わせない (匿名の閲覧ごとに関数を起こさない)
  const { isAuthed } = useAuthNav();

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    getOwnReviewState(occurrenceId)
      .then(value => {
        if (active) setState(value);
      })
      // 失敗は action の側で Sentry に送っている。ここに来るのは通信の失敗だけなので、何も出さない
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [occurrenceId, isAuthed]);

  if (!state) return null;
  const visitedOn = toDotDate(state.visitedOn);

  return (
    <div
      role="status"
      data-testid="own-review-status"
      className="rounded-xl border border-(--line-soft) bg-white p-3 text-xs leading-relaxed text-ink-body"
    >
      <p className="font-bold text-ink-strong">あなたの口コミ（{visitedOn} 訪問）</p>
      {state.status === 'screening' && (
        <p>審査中です（通常1時間以内）。公開されると、ここに表示されます。</p>
      )}
      {state.status === 'published' && <p>公開中です。</p>}
      {state.status === 'rejected' && <p>審査に通らなかったため、公開されていません。</p>}
      {state.status === 'hidden' && <p>非公開になっています。</p>}
      {/* 差し戻しと非公開の理由 (getOwnReviewState が、見せてよい時だけ返す) */}
      {state.reasonCode && <p>理由: {REVIEW_REASON_LABELS[state.reasonCode]}</p>}
      {state.note && <p>運営より: {state.note}</p>}
    </div>
  );
}
