'use client';

import { useState } from 'react';

import { REVIEW_REASON_LABELS } from '@revolution/reviews/labels';
import type { ReviewScreeningReason } from '@revolution/schemas/review-constants';

import { SCREENING_REASON_OPTIONS } from '@/lib/moderation/format';

const NOTE_MAX = 500;

/**
 * 差し戻しの理由 (Figma 15)。スマホは下から出る板、PC はモーダル。理由は審査の 4 種から選び、
 * 投稿者へのひとことは任意 (500 字まで)。投稿者のマイページに出る文を下に見せる
 */
export function RejectDialog({
  initialReason,
  pending,
  onSubmit,
  onClose,
}: {
  initialReason: ReviewScreeningReason | null;
  pending: boolean;
  onSubmit: (reason: ReviewScreeningReason, note: string | null) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReviewScreeningReason | null>(initialReason);
  const [note, setNote] = useState('');
  const trimmed = note.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-title"
      className="fixed inset-0 z-40 flex items-end bg-bar/60 lg:items-center lg:justify-center"
      onKeyDown={event => event.key === 'Escape' && onClose()}
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full rounded-t-2xl bg-surface px-4 pt-5 pb-6 lg:max-w-lg lg:rounded-2xl lg:px-6">
        <div className="flex items-center justify-between">
          <h2 id="reject-title" className="font-display text-[15px] font-bold text-ink-strong">
            差し戻しの理由を選ぶ
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-xl text-ink-muted"
          >
            ×
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="差し戻しの理由">
          {SCREENING_REASON_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={reason === value}
              onClick={() => setReason(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                reason === value
                  ? 'border-primary bg-info-surface text-info-ink'
                  : 'border-line text-ink-body hover:bg-surface-subtle'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-5 block text-xs font-bold text-ink-strong">
          投稿者へのひとこと (任意)
          <textarea
            value={note}
            maxLength={NOTE_MAX}
            onChange={event => setNote(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-xl border border-line px-3 py-2.5 text-sm font-normal text-ink-strong focus:border-primary focus:outline-none"
          />
          <span className="mt-1 block text-right text-[11px] font-normal text-ink-muted">
            {note.length} / {NOTE_MAX}
          </span>
        </label>
        {reason && (
          <div className="mt-2 rounded-lg bg-danger-surface px-3 py-2.5 text-[11px]">
            <p className="text-ink-muted">投稿者のマイページでの表示</p>
            <p className="mt-1 text-danger-ink">
              差し戻しの理由: {REVIEW_REASON_LABELS[reason]}
              {trimmed && `。${trimmed}`}
            </p>
          </div>
        )}
        <button
          type="button"
          disabled={!reason || pending}
          onClick={() => reason && onSubmit(reason, trimmed || null)}
          className="mt-4 w-full rounded-xl bg-danger py-3.5 font-display text-sm font-bold text-white disabled:opacity-45"
        >
          差し戻す
        </button>
      </div>
    </div>
  );
}
