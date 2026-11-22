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

import {
  saveReviewDraft,
  submitReview,
  type ReviewRouteParams,
  type SubmitReviewFailure,
} from '@/actions/review';
import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  RATING_LABELS,
} from '@/lib/reviews/labels';

import type { OwnReview } from '@/lib/reviews/authoring';
import { rescreensOnPhotoAdd } from '@/lib/reviews/eligibility';
import type { OwnReviewPhoto } from '@/lib/reviews/photos/operations';
import { ReviewPhotosField } from '@/components/molecules/reviews/ReviewPhotosField';

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
  /** 会員のこの開催の口コミ。あればその編集になる */
  initial?: OwnReview;
  /** 写真を付けられるか (写真の置き場所がある環境だけ。one-more-time #163) */
  photosEnabled?: boolean;
  /** 付けてある写真 (本人だけが見る、短時間だけ有効な URL) */
  initialPhotos?: OwnReviewPhoto[];
};

type Rating = keyof typeof RATING_LABELS;

export function ReviewForm(props: ReviewFormProps) {
  const initial = props.initial;
  const [rating, setRating] = useState<Rating | null>((initial?.rating as Rating | null) ?? null);
  // 新しい口コミは今日 (選べる最後の日) から。下書きで空のままなら空にしておく
  const [visitedOn, setVisitedOn] = useState(initial ? (initial.visitedOn ?? '') : props.maxDate);
  const [attendance, setAttendance] = useState<ReviewAttendance | null>(
    initial?.attendance ?? null
  );
  const [foodCostBand, setFoodCostBand] = useState<ReviewFoodCostBand | null>(
    initial?.foodCostBand ?? null
  );
  const [goodsCostBand, setGoodsCostBand] = useState<ReviewGoodsCostBand | null>(
    initial?.goodsCostBand ?? null
  );
  const [body, setBody] = useState(initial?.body ?? '');
  const [hasSpoiler, setHasSpoiler] = useState(initial?.hasSpoiler ?? false);
  // 提出した口コミの編集か。下書きを保存できるのは、まだ提出していない口コミだけ (提出の後は、直して出し直す)
  const isResubmit = initial !== undefined && initial.status !== 'draft';
  const [draftSaved, setDraftSaved] = useState(false);
  // 口コミの行があるか (写真は口コミに付けるので、無ければ先に下書きを保存する)
  const [hasReview, setHasReview] = useState(initial !== undefined);
  // 写真の欄が作業中 (先の下書きの保存・上げる・外す・並べ替える)。その間は投稿と下書きの保存を止める
  const [photosBusy, setPhotosBusy] = useState(false);
  // 提出の失敗 (全体の文・欄ごとの誤り・ログインが要るか) を 1 つで持つ
  const [failure, setFailure] = useState<SubmitReviewFailure | null>(null);
  const fieldErrors = failure?.fieldErrors ?? {};
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = pending || photosBusy;
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

  const canSubmit = rating !== null && visitedOn !== '' && !locked;

  // 送る内容 (提出と下書きの保存で共通。下書きは星と訪問日が空でよい)
  const content = { attendance, foodCostBand, goodsCostBand, body, hasSpoiler };

  /** action を走らせ、失敗は欄の下と全体の文に出す。通信の失敗は入力を残したまま、もう一度押せるようにする */
  function run<T extends { ok: true } | SubmitReviewFailure>(
    action: () => Promise<T>,
    onOk: () => void,
    networkError: string
  ) {
    setDraftSaved(false);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setFailure(null);
          onOk();
          return;
        }
        setFailure(result as SubmitReviewFailure);
      } catch {
        setFailure({ ok: false, error: networkError });
      }
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // 星が無い間は送信のボタンを押せない (型を絞るためだけの判定)
    if (rating === null) return;
    run(
      () => submitReview(props.route, { ...content, rating, visitedOn }),
      () => {
        setSubmittedAt(new Date());
        window.scrollTo({ top: 0 });
      },
      '投稿できませんでした。通信を確かめて、もう一度お試しください'
    );
  }

  /** 下書きを保存する (ボタンと、写真を付ける前の両方)。保存できなければ理由を出して false */
  async function saveDraft(): Promise<boolean> {
    try {
      const result = await saveReviewDraft(props.route, {
        ...content,
        rating,
        visitedOn: visitedOn || null,
      });
      if (result.ok) {
        setFailure(null);
        setHasReview(true);
        return true;
      }
      setFailure(result);
    } catch {
      setFailure({
        ok: false,
        error: '保存できませんでした。通信を確かめて、もう一度お試しください',
      });
    }
    return false;
  }

  /** 写真を付ける前に、口コミの行を作る (無ければ下書きを保存する) */
  async function ensureReview(): Promise<boolean> {
    return hasReview || saveDraft();
  }

  function onSaveDraft() {
    setDraftSaved(false);
    startTransition(async () => {
      if (await saveDraft()) setDraftSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col" noValidate>
      {initial && <EditingNotice status={initial.status} />}
      <div className="rounded-xl border border-(--line-soft) bg-primary-50/40 px-3 py-2 text-xs leading-relaxed text-ink-body">
        <p>{props.eventName}</p>
        <p className="text-ink-muted">
          {props.venueName} / {props.period}
        </p>
      </div>

      <div className="pt-5 text-center">
        <p className="text-sm text-ink-muted">この開催の満足度は?</p>
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
          {rating !== null ? RATING_LABELS[rating] : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-5">
        <FieldLabel htmlFor={ids.visitedOn} badge="required">
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
        <FieldLabel badge="optional">使った金額（1人分）</FieldLabel>
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
        <FieldLabel htmlFor={ids.body} badge="optional">
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

      {props.photosEnabled && (
        <ReviewPhotosField
          route={props.route}
          initialPhotos={props.initialPhotos ?? []}
          ensureReview={ensureReview}
          onBusyChange={setPhotosBusy}
          disabled={pending}
          rescreensOnAdd={initial !== undefined && rescreensOnPhotoAdd(initial.status)}
        />
      )}

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
            className={`absolute top-0.5 left-0 size-5.5 rounded-full bg-white shadow transition-transform ${
              hasSpoiler ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {failure && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-status-cancelled-surface px-3 py-2 text-sm text-status-cancelled"
        >
          {failure.error}
          {failure.needsAuth && (
            <>
              {' '}
              <Link
                href={`/login?next=${encodeURIComponent(`${props.occurrencePath}/review`)}`}
                className="underline"
              >
                ログインする
              </Link>
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-5 w-full rounded-2xl bg-primary-strong p-4 font-display text-base font-bold text-white transition-colors hover:bg-primary-strong-hover disabled:opacity-50"
      >
        {pending ? '送っています…' : isResubmit ? '直して出し直す' : '口コミを投稿する'}
      </button>
      {!isResubmit && (
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={locked}
          className="mt-3 w-full rounded-2xl border border-(--line-soft) bg-white p-3 font-display text-sm font-bold text-ink-strong transition-colors hover:bg-muted disabled:opacity-50"
        >
          下書きを保存
        </button>
      )}
      {draftSaved && (
        <p role="status" className="pt-2 text-center text-xs text-ink-muted">
          下書きを保存しました。別の端末からも続きを書けます（審査には回りません）
        </p>
      )}
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

const BADGES = {
  required: { label: '必須', className: 'bg-status-cancelled-surface text-status-cancelled' },
  optional: { label: '任意', className: 'bg-status-scheduled-surface text-ink-muted' },
} as const;

function FieldLabel(props: {
  children: React.ReactNode;
  htmlFor?: string;
  id?: string;
  badge?: keyof typeof BADGES;
}) {
  const Tag = props.htmlFor ? 'label' : 'p';
  const badge = props.badge && BADGES[props.badge];
  return (
    <Tag
      htmlFor={props.htmlFor}
      id={props.id}
      className="flex items-center gap-1.5 text-xs font-bold text-ink-strong"
    >
      {props.children}
      {badge && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}>
          {badge.label}
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
        <FieldLabel id={groupId} badge="optional">
          {props.label}
        </FieldLabel>
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

/** 既にある口コミを開いた時の案内 (1 開催 1 件のため、もう 1 件ではなくその編集になる) */
function EditingNotice(props: { status: OwnReview['status'] }) {
  const text =
    props.status === 'draft'
      ? '保存した下書きの続きです。'
      : props.status === 'published'
        ? 'この開催にはもう口コミを書いています。公開中の口コミを直すと、もう一度審査されるまで公開されません。'
        : 'この開催にはもう口コミを書いています。直して出し直すと、もう一度審査されます。';
  return (
    <p className="mb-4 rounded-xl border border-(--line-soft) bg-white p-3 text-sm text-ink-body">
      {text}
    </p>
  );
}
