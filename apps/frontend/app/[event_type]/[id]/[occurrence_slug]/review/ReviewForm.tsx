'use client';

/**
 * 口コミの投稿の欄 (Figma #7 の左)。写真と下書きの欄は後のチケット (#162・#163) で足す。
 * 提出に成功したら、同じ場所に投稿後の画面 (`ReviewSubmitted`) を出す。
 */

import Link from 'next/link';
import { useId, useState, useTransition } from 'react';

import {
  REVIEW_ATTENDANCES,
  REVIEW_BODY_MAX_CHARS,
  REVIEW_FOOD_COST_BANDS,
  REVIEW_GOODS_COST_BANDS,
  type ReviewAttendance,
  type ReviewFoodCostBand,
  type ReviewGoodsCostBand,
} from '@revolution/schemas/review';

import { submitReview, type ReviewFieldErrors, type ReviewRouteParams } from '@/actions/review';
import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  RATING_LABELS,
} from '@/lib/reviews/labels';

import { ReviewSubmitted } from './ReviewSubmitted';

export type ReviewFormProps = {
  route: ReviewRouteParams;
  eventName: string;
  venueName: string;
  /** 表示用の期間 (例: 2026.07.03 – 08.16) */
  period: string;
  /** 訪問日に選べる最初と最後の日 (YYYY-MM-DD、JST) */
  minDate: string;
  maxDate: string;
  occurrencePath: string;
  shareUrl: string;
};

export function ReviewForm(props: ReviewFormProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [visitedOn, setVisitedOn] = useState(props.maxDate);
  const [attendance, setAttendance] = useState<ReviewAttendance | null>(null);
  const [foodCostBand, setFoodCostBand] = useState<ReviewFoodCostBand | null>(null);
  const [goodsCostBand, setGoodsCostBand] = useState<ReviewGoodsCostBand | null>(null);
  const [body, setBody] = useState('');
  const [hasSpoiler, setHasSpoiler] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldErrors>({});
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { visitedOn: useId(), body: useId(), spoiler: useId() };

  if (submittedAt) {
    return (
      <ReviewSubmitted
        submittedAt={submittedAt}
        eventName={props.eventName}
        venueName={props.venueName}
        occurrencePath={props.occurrencePath}
        shareUrl={props.shareUrl}
      />
    );
  }

  const canSubmit = rating !== null && visitedOn !== '' && !pending;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (rating === null) {
      setFieldErrors({ rating: '星を選んでください' });
      return;
    }
    startTransition(async () => {
      const result = await submitReview(props.route, {
        rating,
        visitedOn,
        attendance,
        foodCostBand,
        goodsCostBand,
        body,
        hasSpoiler,
      });
      if (result.ok) {
        setSubmittedAt(new Date());
        window.scrollTo({ top: 0 });
        return;
      }
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col" noValidate>
      <div className="rounded-xl border border-(--line-soft) bg-primary-50/40 px-3 py-2 text-xs leading-relaxed text-ink-body">
        <p>{props.eventName}</p>
        <p className="text-ink-muted">
          {props.venueName} / {props.period}
        </p>
      </div>

      <fieldset className="pt-5 text-center">
        <legend className="w-full text-sm text-ink-muted">この開催の満足度は?</legend>
        <div className="flex justify-center gap-1 pt-2" role="radiogroup" aria-label="星の数">
          {([1, 2, 3, 4, 5] as const).map(value => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} つ星 (${RATING_LABELS[value]})`}
              onClick={() => setRating(value)}
              className={`text-4xl leading-none transition-colors ${
                rating !== null && value <= rating
                  ? 'text-accent-yellow-deep'
                  : 'text-(--line-strong)'
              }`}
            >
              ★
            </button>
          ))}
        </div>
        <p
          className="min-h-6 pt-1 font-display text-sm font-bold text-ink-strong"
          aria-live="polite"
        >
          {rating !== null ? RATING_LABELS[rating as 1 | 2 | 3 | 4 | 5] : ''}
        </p>
        <FieldError message={fieldErrors.rating} />
      </fieldset>

      <div className="flex flex-col gap-2 pt-5">
        <FieldLabel htmlFor={ids.visitedOn} required>
          訪問日
        </FieldLabel>
        <input
          id={ids.visitedOn}
          type="date"
          required
          min={props.minDate}
          max={props.maxDate}
          value={visitedOn}
          onChange={event => setVisitedOn(event.target.value)}
          className="w-full rounded-xl border border-(--line-strong) bg-white px-3 py-3 text-sm text-ink-strong"
        />
        <p className="text-xs text-ink-muted">
          開催期間（{props.period}
          ）の中で、今日までの日付を選べます。ほかの人には年と月だけが表示されます。
        </p>
        <FieldError message={fieldErrors.visitedOn} />
      </div>

      <ChipGroup
        label="どうやって入りましたか?"
        options={REVIEW_ATTENDANCES}
        labels={ATTENDANCE_LABELS}
        value={attendance}
        onChange={setAttendance}
      />

      <div className="flex flex-col gap-2 pt-5">
        <FieldLabel optional>使った金額（1人分）</FieldLabel>
        <ChipGroup
          label="飲食代"
          small
          options={REVIEW_FOOD_COST_BANDS}
          labels={FOOD_COST_BAND_LABELS}
          value={foodCostBand}
          onChange={setFoodCostBand}
        />
        <ChipGroup
          label="グッズ代"
          small
          options={REVIEW_GOODS_COST_BANDS}
          labels={GOODS_COST_BAND_LABELS}
          value={goodsCostBand}
          onChange={setGoodsCostBand}
        />
        <p className="text-xs text-ink-muted">
          金額は帯で表示されます。3件以上集まると、開催ページに「よくある金額」として集計されます。
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-5">
        <FieldLabel htmlFor={ids.body} optional>
          本文
        </FieldLabel>
        <textarea
          id={ids.body}
          value={body}
          onChange={event => setBody(event.target.value)}
          maxLength={REVIEW_BODY_MAX_CHARS}
          rows={6}
          className="min-h-36 w-full rounded-xl border border-(--line-strong) bg-white px-3 py-2.5 text-sm leading-relaxed text-ink-body focus:border-primary-500 focus:outline-none"
        />
        <p className="text-right text-xs text-ink-muted tabular-nums">
          {body.length} / {REVIEW_BODY_MAX_CHARS}
        </p>
        <FieldError message={fieldErrors.body} />
      </div>

      <div className="flex items-center justify-between gap-4 pt-5">
        <label htmlFor={ids.spoiler} className="flex flex-col gap-0.5">
          <span className="text-xs font-bold text-ink-strong">ネタバレを含む</span>
          <span className="text-xs text-ink-muted">オンにすると、本文をたたんで表示します</span>
        </label>
        <button
          id={ids.spoiler}
          type="button"
          role="switch"
          aria-checked={hasSpoiler}
          onClick={() => setHasSpoiler(value => !value)}
          className={`relative h-6.5 w-11 shrink-0 rounded-full transition-colors ${
            hasSpoiler ? 'bg-primary-strong' : 'bg-(--line-strong)'
          }`}
        >
          <span
            className={`absolute top-0.5 size-5.5 rounded-full bg-white shadow transition-transform ${
              hasSpoiler ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-status-cancelled-surface px-3 py-2 text-sm text-status-cancelled"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-5 w-full rounded-2xl bg-primary-strong p-4 font-display text-base font-bold text-white transition-colors hover:bg-primary-strong-hover disabled:opacity-50"
      >
        {pending ? '投稿しています…' : '口コミを投稿する'}
      </button>
      <p className="pt-2 text-center text-xs text-ink-muted">
        投稿された口コミは公開前に審査されます(通常1時間以内)
      </p>
      <p className="pt-4 text-center text-xs">
        <Link href={props.occurrencePath} className="text-primary-700 underline">
          開催ページに戻る
        </Link>
      </p>
    </form>
  );
}

function FieldLabel(props: {
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
}) {
  const Tag = props.htmlFor ? 'label' : 'p';
  return (
    <Tag
      htmlFor={props.htmlFor}
      className="flex items-center gap-1.5 text-xs font-bold text-ink-strong"
    >
      {props.children}
      {props.required && (
        <span className="rounded bg-status-cancelled-surface px-1.5 py-0.5 text-[10px] text-status-cancelled">
          必須
        </span>
      )}
      {props.optional && (
        <span className="rounded bg-status-scheduled-surface px-1.5 py-0.5 text-[10px] text-ink-muted">
          任意
        </span>
      )}
    </Tag>
  );
}

function ChipGroup<T extends string>(props: {
  label: string;
  /** 金額の小見出しのように、任意のバッジを付けない小さな見出しにする */
  small?: boolean;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  const groupId = useId();
  return (
    <div className={`flex flex-col gap-2 ${props.small ? '' : 'pt-5'}`}>
      {props.small ? (
        <p id={groupId} className="text-xs text-ink-body">
          {props.label}
        </p>
      ) : (
        <p id={groupId} className="flex items-center gap-1.5 text-xs font-bold text-ink-strong">
          {props.label}
          <span className="rounded bg-status-scheduled-surface px-1.5 py-0.5 text-[10px] text-ink-muted">
            任意
          </span>
        </p>
      )}
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
        {props.options.map(option => {
          const selected = props.value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              // もう一度押すと選択を外す (任意の欄なので、空に戻せるように)
              onClick={() => props.onChange(selected ? null : option)}
              className={`rounded-full border px-3.5 py-2 text-[13px] transition-colors ${
                selected
                  ? 'border-primary-strong bg-primary-50 font-bold text-primary-strong'
                  : 'border-(--line-strong) bg-white text-ink-body'
              }`}
            >
              {props.labels[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-status-cancelled">
      {message}
    </p>
  );
}
