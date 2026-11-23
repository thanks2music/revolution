'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
  toScreeningReason,
} from '@revolution/reviews/labels';
import type { ModerationPhoto } from '@revolution/reviews/moderation';
import type {
  ReviewAttendance,
  ReviewFoodCostBand,
  ReviewGoodsCostBand,
  ReviewReasonCode,
  ReviewScreeningReason,
} from '@revolution/schemas/review';

import {
  publishReview,
  rejectReview,
  requeueReviewAction,
  type ModerationActionResult,
} from '@/actions/moderation';
import {
  aiFailureSummary,
  elapsedLabel,
  formatDate,
  formatDateTime,
  historyLine,
  starsLabel,
  type DetailKind,
  type HistoryEntry,
} from '@/lib/moderation/format';
import {
  initialMarks,
  missingReasonMessage,
  publishLabel,
  toPhotoDecisions,
  type PhotoMark,
} from '@/lib/moderation/marks';

import { PhotoLightbox } from './PhotoLightbox';
import { PhotoMarkControls } from './PhotoMarkControls';
import { PhotoPicture } from './PhotoPicture';
import { RejectDialog } from './RejectDialog';

export type ReviewDetailReview = {
  id: number;
  rating: number | null;
  body: string | null;
  visitedOn: string | null;
  attendance: ReviewAttendance | null;
  foodCostBand: ReviewFoodCostBand | null;
  goodsCostBand: ReviewGoodsCostBand | null;
  hasSpoiler: boolean;
  submittedAt: string | null;
  reasonCode: ReviewReasonCode | null;
  aiReason: string | null;
  aiError: string | null;
};

/** 開いている間に起きたこと。superseded = 状態が変わった (F-6)、photos_changed = 写真が変わった (F-7) */
type Blocked = 'superseded' | 'photos_changed' | null;

/**
 * 口コミの確認の本体 (Figma 14、136:355〜136:607、F-6〜F-12)。写真の印を持ち、公開・差し戻し・
 * もう一度 AI にかけるを送る。書けたらサーバーが一覧へ戻す (知らせは一覧で出す)
 */
export function ReviewDetail({
  kind,
  pendingSince,
  review,
  title,
  authorName,
  photos,
  history,
}: {
  kind: DetailKind;
  pendingSince: string | null;
  review: ReviewDetailReview;
  title: string;
  authorName: string | null;
  photos: ModerationPhoto[];
  history: HistoryEntry[];
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<PhotoMark[]>(() => initialMarks(photos));
  const [blocked, setBlocked] = useState<Blocked>(kind === 'closed' ? 'superseded' : null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const locked = blocked !== null || pending;
  const aiFailedAt =
    history.findLast(entry => entry.reasonCode === 'ai_failure')?.createdAt ?? null;
  // 写真の印と公開・差し戻しは確認待ちだけ。止まっている審査中は AI にかけ直すだけ (Figma 14)、
  // まだ止まっていない審査中は待つだけ (操作を出さない)
  const canDecide = kind === 'unsure' || kind === 'ai_failure';
  const aiJudged = kind !== 'ai_failure';
  const missing = missingReasonMessage(marks);

  const updateMark = (next: PhotoMark) =>
    setMarks(current => current.map(mark => (mark.id === next.id ? next : mark)));
  const closeZoom = useCallback(() => setZoomIndex(null), []);

  const target = { reviewId: review.id, submittedAt: review.submittedAt ?? '', title };

  const handle = (result: ModerationActionResult) => {
    if (result.kind === 'forbidden') router.replace('/forbidden');
    else if (result.kind === 'error') setSaveFailed(true);
    else setBlocked(result.kind);
  };

  const run = (action: () => Promise<ModerationActionResult>) => {
    setSaveFailed(false);
    startTransition(async () => {
      // 書けた時はサーバーが一覧へ redirect するので、戻ってくるのは書けなかった時だけ
      handle(await action());
    });
  };

  const publish = () => {
    const decisions = toPhotoDecisions(marks, 'publish');
    if (decisions) run(() => publishReview({ ...target, photos: decisions }));
  };
  const reject = (reasonCode: ReviewScreeningReason, reasonNote: string | null) => {
    const decisions = toPhotoDecisions(marks, 'reject') ?? [];
    setRejecting(false);
    run(() => rejectReview({ ...target, photos: decisions, reasonCode, reasonNote }));
  };
  const requeue = () => run(() => requeueReviewAction(target));

  const reload = () => {
    setBlocked(null);
    router.refresh();
  };

  return (
    <article className="relative bg-surface lg:self-start lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line">
      {blocked === 'superseded' && (
        <div role="alert" className="border-b border-danger bg-danger-surface px-4 py-3.5">
          <p className="text-[13px] font-bold text-danger-ink">
            {kind === 'closed'
              ? 'この口コミは確認待ちではありません'
              : 'この口コミは状態が変わりました'}
          </p>
          <p className="mt-1 text-xs text-danger-ink">
            {kind === 'closed'
              ? '公開・差し戻しが済んでいるか、ほかの操作で状態が変わっています。一覧に戻ってください。'
              : '開いている間に、投稿者が出し直したか削除したか、状態が変わりました。一覧に戻って読み直してください。'}
          </p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-xl border border-danger-ink bg-surface px-3 py-2 text-xs font-bold text-danger-ink"
          >
            ‹ 一覧に戻る
          </Link>
        </div>
      )}
      {blocked === 'photos_changed' && (
        <div role="alert" className="border-b border-warning bg-warning-surface px-4 py-3.5">
          <p className="text-[13px] font-bold text-warning-ink">写真が変わりました</p>
          <p className="mt-1 text-xs text-warning-ink">
            開いている間に、投稿者が写真を足したか外しました。読み直して確かめてください。
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 rounded-xl border border-warning bg-surface px-3 py-2 text-xs font-bold text-warning-ink"
          >
            ↻ 読み直す
          </button>
        </div>
      )}

      <JudgementBanner
        kind={kind}
        review={review}
        aiFailedAt={aiFailedAt}
        pendingSince={pendingSince}
      />

      <div className="px-4 pt-4 pb-2 lg:px-6">
        <h1 className="text-sm font-bold text-ink-strong">{title}</h1>
        <p className="mt-1 text-[11px] text-ink-muted">
          {authorName ?? '退会済みユーザー'}
          {review.submittedAt && ` ・ 投稿 ${formatDateTime(review.submittedAt)}`}
        </p>
      </div>
      <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 px-4 py-2 text-xs lg:px-6">
        <Row label="星" value={starsLabel(review.rating)} />
        <Row label="訪問日" value={review.visitedOn ? formatDate(review.visitedOn) : '—'} />
        <Row
          label="入り方"
          value={review.attendance ? ATTENDANCE_LABELS[review.attendance] : '—'}
        />
        <Row
          label="飲食代"
          value={review.foodCostBand ? FOOD_COST_BAND_LABELS[review.foodCostBand] : '—'}
        />
        <Row
          label="グッズ代"
          value={review.goodsCostBand ? GOODS_COST_BAND_LABELS[review.goodsCostBand] : '—'}
        />
        <Row label="ネタバレ" value={review.hasSpoiler ? 'あり' : 'なし'} />
      </dl>
      <p className="px-4 py-2 text-[13px] whitespace-pre-wrap text-ink-body lg:px-6">
        {review.body}
      </p>

      {photos.length > 0 && (
        <section className="px-4 pt-2 pb-4 lg:px-6" aria-label="写真">
          <h2 className="text-xs font-bold text-ink-strong">
            写真 {photos.length} 枚（タップで拡大）
          </h2>
          <ul className="mt-2.5 grid grid-cols-3 gap-2 lg:flex lg:flex-wrap">
            {photos.map((photo, index) => {
              const mark = marks[index];
              return (
                <li key={photo.id} className="flex min-w-0 flex-col gap-1.5 lg:w-[110px]">
                  <button
                    type="button"
                    onClick={() => setZoomIndex(index)}
                    aria-label={`写真 ${mark.number} を拡大`}
                    className={`relative aspect-square w-full overflow-hidden rounded-[10px] bg-photo lg:size-[110px] ${
                      mark.hide ? 'border-2 border-warning' : ''
                    }`}
                  >
                    {photo.view && (
                      <PhotoPicture
                        view={photo.view}
                        sizes="110px"
                        alt=""
                        lazy
                        className="size-full object-cover"
                      />
                    )}
                    <span className="absolute top-1.5 left-2 text-[10px] font-bold text-white drop-shadow">
                      写真 {mark.number}
                    </span>
                  </button>
                  {canDecide && (
                    <PhotoMarkControls
                      mark={mark}
                      aiJudged={aiJudged}
                      disabled={locked}
                      onChange={updateMark}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <details className="border-t border-line-soft px-4 py-3 lg:px-6">
          <summary className="cursor-pointer text-[13px] font-bold text-ink-strong">
            これまでの判断 ({history.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-1.5 text-xs">
            {history.map(entry => {
              const { who, what } = historyLine(entry);
              return (
                <li key={entry.id} className="flex gap-3">
                  <span className="shrink-0 text-ink-muted">{formatDateTime(entry.createdAt)}</span>
                  <span>
                    <span
                      className={`font-bold ${who === 'BOSS' ? 'text-info-ink' : 'text-ink-strong'}`}
                    >
                      {who}:
                    </span>{' '}
                    {what}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      {kind !== 'screening' && (
        <Actions
          kind={kind}
          locked={locked}
          missing={canDecide ? missing : null}
          publishText={publishLabel(marks)}
          onPublish={publish}
          onReject={() => setRejecting(true)}
          onRequeue={requeue}
        />
      )}

      {saveFailed && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-28 z-30 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-danger-ink px-4 py-3 text-sm font-bold text-white shadow-lg lg:bottom-8"
        >
          <span aria-hidden>!</span>
          保存できませんでした。もう一度お試しください。
        </div>
      )}
      {rejecting && (
        <RejectDialog
          initialReason={toScreeningReason(review.reasonCode)}
          pending={pending}
          onSubmit={reject}
          onClose={() => setRejecting(false)}
        />
      )}
      {zoomIndex !== null && (
        <PhotoLightbox
          photos={photos}
          marks={marks}
          index={zoomIndex}
          aiJudged={aiJudged}
          disabled={locked || !canDecide}
          onIndexChange={setZoomIndex}
          onMarkChange={updateMark}
          onClose={closeZoom}
        />
      )}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-strong">{value}</dd>
    </>
  );
}

/** 上の帯: AI が迷った理由 (黄) / AI の審査に失敗 (赤) / 審査中のまま (灰) */
function JudgementBanner({
  kind,
  review,
  aiFailedAt,
  pendingSince,
}: {
  kind: DetailKind;
  review: ReviewDetailReview;
  aiFailedAt: string | null;
  pendingSince: string | null;
}) {
  if (kind === 'unsure' && review.aiReason) {
    return (
      <div className="border-b border-warning bg-warning-surface px-4 py-3.5 lg:px-6">
        <p className="text-[11px] font-bold text-warning-ink">AI が迷った理由</p>
        <p className="mt-1.5 font-display text-sm font-bold whitespace-pre-wrap text-ink-strong">
          {review.aiReason}
        </p>
      </div>
    );
  }
  if (kind === 'ai_failure') {
    const { label, detail } = aiFailureSummary(review.aiError);
    return (
      <div className="border-b border-danger bg-danger-surface px-4 py-3.5 lg:px-6">
        <p className="text-[11px] font-bold text-danger-ink">AI の審査に失敗しました</p>
        <p className="mt-1.5 font-display text-sm font-bold text-ink-strong">
          {label} ({detail.replace(/。$/, '')}){aiFailedAt && ` ・ ${formatDateTime(aiFailedAt)}`}
          <br />
          本文と写真は BOSS が目で確かめるか、もう一度 AI にかけてください。
        </p>
        {review.aiError && (
          <p className="mt-1.5 font-mono text-[10px] break-all text-ink-tertiary">
            {review.aiError}
          </p>
        )}
      </div>
    );
  }
  if (kind === 'screening') {
    return (
      <div className="border-b border-line bg-surface-subtle px-4 py-3.5 lg:px-6">
        <p className="text-[11px] font-bold text-ink-tertiary">審査中</p>
        <p className="mt-1.5 font-display text-sm font-bold text-ink-strong">
          AI が審査しています。結果は数分で出ます。30
          分たっても終わらなければ、一覧の「止まっている口コミ」に出ます。
        </p>
      </div>
    );
  }
  if (kind === 'stuck' && pendingSince) {
    // 経過は提出か、最後の「もう一度 AI にかける」の遅い方から (一覧と同じ。migration 0027)
    return (
      <div className="border-b border-line bg-surface-subtle px-4 py-3.5 lg:px-6">
        <p className="text-[11px] font-bold text-ink-tertiary">
          審査中のまま {elapsedLabel(pendingSince)}
        </p>
        <p className="mt-1.5 font-display text-sm font-bold text-ink-strong">
          AI の審査が終わっていません。処理が途中で止まった可能性があります。もう一度 AI
          にかけてください。
        </p>
      </div>
    );
  }
  return null;
}

/** 下の操作 (スマホは下に固定、PC は右下に並べる) */
function Actions({
  kind,
  locked,
  missing,
  publishText,
  onPublish,
  onReject,
  onRequeue,
}: {
  kind: DetailKind;
  locked: boolean;
  missing: string | null;
  publishText: string;
  onPublish: () => void;
  onReject: () => void;
  onRequeue: () => void;
}) {
  const requeueOutlined =
    'flex-1 rounded-[14px] border border-primary bg-surface py-3.5 font-display text-sm font-bold text-primary disabled:opacity-45 lg:flex-none lg:px-4';
  if (kind === 'stuck') {
    return (
      <div className="sticky bottom-0 border-t border-line-soft bg-surface px-4 pt-3 pb-5 lg:static lg:px-6">
        <p className="mb-3 text-[11px] text-ink-muted">
          押すと審査中に戻り、一覧から外れます。結果は数分で出ます。
        </p>
        <button
          type="button"
          disabled={locked}
          onClick={onRequeue}
          className="w-full rounded-[14px] bg-primary py-3.5 font-display text-sm font-bold text-white disabled:opacity-45"
        >
          ↻ もう一度 AI にかける
        </button>
      </div>
    );
  }
  return (
    <div className="sticky bottom-0 border-t border-line-soft bg-surface lg:static">
      {kind === 'unsure' && (
        <div className="flex flex-col items-center gap-1.5 px-4 pt-3">
          {missing && <p className="text-xs font-bold text-danger-ink">{missing}</p>}
          <button
            type="button"
            disabled={locked}
            onClick={onRequeue}
            className="py-1.5 text-sm font-bold text-primary disabled:opacity-45"
          >
            ↻ もう一度 AI にかける
          </button>
        </div>
      )}
      {kind === 'ai_failure' && missing && (
        <p className="px-4 pt-3 text-center text-xs font-bold text-danger-ink">{missing}</p>
      )}
      <div className="flex flex-wrap gap-2.5 px-4 pt-3 pb-5 lg:justify-end lg:px-6">
        {kind === 'ai_failure' && (
          <button
            type="button"
            disabled={locked}
            onClick={onRequeue}
            className={`w-full lg:w-auto ${requeueOutlined}`}
          >
            ↻ もう一度 AI にかける
          </button>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={onReject}
          className="w-[110px] rounded-[14px] border border-danger bg-surface py-3.5 font-display text-sm font-bold text-danger disabled:opacity-45"
        >
          差し戻す
        </button>
        <button
          type="button"
          disabled={locked || missing !== null}
          onClick={onPublish}
          className="min-w-0 flex-1 rounded-[14px] bg-primary px-3 py-3.5 font-display text-sm font-bold text-white disabled:opacity-45 lg:flex-none lg:px-6"
        >
          {publishText}
        </button>
      </div>
    </div>
  );
}
