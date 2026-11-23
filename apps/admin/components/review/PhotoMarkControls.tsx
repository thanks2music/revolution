'use client';

import type { ReviewReportReason } from '@revolution/schemas/review-constants';

import type { PhotoMark } from '@/lib/moderation/marks';
import { REPORT_REASON_OPTIONS } from '@/lib/moderation/format';

/**
 * 写真 1 枚の「非公開」の印と理由 (Figma 14・F-11・F-12)。一覧の写真の欄と拡大の上で同じ物を使う
 * (どちらで変えても、もう片方に出る)
 */
export function PhotoMarkControls({
  mark,
  aiJudged,
  disabled,
  onChange,
  size = 'sm',
}: {
  mark: PhotoMark;
  /** AI の判定があるか (AI の審査に失敗した口コミは「AI の判定なし」) */
  aiJudged: boolean;
  disabled: boolean;
  onChange: (next: PhotoMark) => void;
  size?: 'sm' | 'lg';
}) {
  const large = size === 'lg';
  const text = large ? 'text-sm' : 'text-[10px]';
  const missing = mark.hide && !mark.reason;
  return (
    <div className={`flex flex-col ${large ? 'gap-3' : 'gap-1.5'}`}>
      <label className={`flex items-center gap-1 ${text}`}>
        <input
          type="checkbox"
          checked={mark.hide}
          disabled={disabled}
          onChange={event => onChange({ ...mark, hide: event.target.checked })}
          className={`${large ? 'size-5' : 'size-3.5'} accent-danger-ink`}
        />
        <span className={mark.hide ? 'font-bold text-danger-ink' : 'text-ink-muted'}>非公開</span>
        {aiJudged && mark.byAi && (
          <span className="rounded-full bg-info-surface px-1.5 py-px text-[10px] font-bold text-info-ink">
            AI
          </span>
        )}
      </label>
      {mark.hide && (
        <select
          aria-label={`写真 ${mark.number} の非公開の理由`}
          value={mark.reason ?? ''}
          disabled={disabled}
          onChange={event =>
            onChange({
              ...mark,
              reason: (event.target.value || null) as ReviewReportReason | null,
            })
          }
          className={`w-full rounded-md border bg-surface ${large ? 'px-3 py-3 text-sm' : 'px-1.5 py-1 text-[10px]'} font-bold ${
            missing ? 'border-danger-ink text-ink-disabled' : 'border-line text-ink-strong'
          }`}
        >
          <option value="">理由を選ぶ</option>
          {REPORT_REASON_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      {!aiJudged && (
        <span className="self-start rounded-full bg-surface-subtle px-1.5 py-px text-[10px] font-bold text-ink-body">
          AI の判定なし
        </span>
      )}
    </div>
  );
}
