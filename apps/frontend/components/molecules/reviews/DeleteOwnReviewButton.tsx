'use client';

/**
 * 自分の口コミの削除 (#12 マイページ、one-more-time #162)。押し間違いを防ぐため、もう一度押して確かめる。
 * ブラウザの confirm は使わない (画面の操作を止めるため)。消したらページを読み直す。
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteReview, type ReviewRouteParams } from '@/actions/review';

export function DeleteOwnReviewButton(props: { route: ReviewRouteParams; reviewId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteReview(props.route, props.reviewId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError('削除できませんでした。通信を確かめて、もう一度お試しください');
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-ink-muted hover:underline"
      >
        削除
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span className="font-normal text-ink-body">削除しますか？</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-status-cancelled hover:underline disabled:opacity-50"
      >
        {pending ? '削除しています…' : '削除する'}
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        disabled={pending}
        className="text-ink-muted hover:underline"
      >
        やめる
      </button>
      {error && (
        <span role="alert" className="w-full font-normal text-status-cancelled">
          {error}
        </span>
      )}
    </span>
  );
}
