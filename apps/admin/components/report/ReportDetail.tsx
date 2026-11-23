'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ATTENDANCE_LABELS,
  FOOD_COST_BAND_LABELS,
  GOODS_COST_BAND_LABELS,
} from '@revolution/reviews/labels';
import type { ModerationPhoto } from '@revolution/reviews/moderation';
import type { ReviewReportReason } from '@revolution/schemas/review-constants';

import { handleReportsAction, type ReportActionResult } from '@/actions/reports';
import { PhotoMarkControls } from '@/components/review/PhotoMarkControls';
import { PhotoPicture } from '@/components/review/PhotoPicture';
import { RejectDialog, type ReasonDialogCopy } from '@/components/review/RejectDialog';
import {
  REPORT_REASON_OPTIONS,
  formatDate,
  reportReasonsLabel,
  reviewStateLabel,
  starsLabel,
} from '@/lib/moderation/format';
import {
  initialMarks,
  missingReasonMessage,
  toPhotoDecisions,
  type PhotoMark,
} from '@/lib/moderation/marks';

const HIDE_COPY: ReasonDialogCopy = {
  title: '非公開の理由を選ぶ',
  prefix: '非公開の理由',
  submit: '非公開にする',
};

export type ReportDetailReview = {
  id: number;
  status: string;
  rating: number | null;
  body: string | null;
  visitedOn: string | null;
  attendance: keyof typeof ATTENDANCE_LABELS | null;
  foodCostBand: keyof typeof FOOD_COST_BAND_LABELS | null;
  goodsCostBand: keyof typeof GOODS_COST_BAND_LABELS | null;
  hasSpoiler: boolean;
  submittedAt: string | null;
};

type Blocked = 'superseded' | 'photos_changed' | 'not_published' | null;

/**
 * 通報された口コミの処理 (Figma 16 / 16-PC `88:438`)。上に通報 (件数・理由) と操作、下に口コミ全体。
 * 口コミ全体でネタバレの印と写真ごとの非公開を変えると、「問題なしにする」が「直して公開のままにする」になる
 * (2026-11-24 BOSS 確定)。非公開は差し戻しと同じ形のダイアログで理由を選ぶ (初めは最も多い通報の理由)
 */
export function ReportDetail({
  review,
  title,
  authorName,
  photos,
  reportIds,
  reasons,
  firstReportedLabel,
}: {
  review: ReportDetailReview;
  title: string;
  authorName: string | null;
  photos: ModerationPhoto[];
  reportIds: number[];
  /** 未処理の通報の理由ごとの件数 (多い順) */
  reasons: { code: ReviewReportReason; count: number }[];
  /** 「最初の通報 2時間前」の「2時間前」(サーバーで作る。ブラウザで数え直すと描画の食い違いになる) */
  firstReportedLabel: string | null;
}) {
  const router = useRouter();
  // 写真の印の初めの値は今の非公開 (AI の勧めかどうかはここでは出さない)
  const [initial] = useState(() => initialMarks(photos).map(mark => ({ ...mark, byAi: false })));
  const [marks, setMarks] = useState<PhotoMark[]>(initial);
  const [spoiler, setSpoiler] = useState(review.hasSpoiler);
  const [blocked, setBlocked] = useState<Blocked>(
    review.status === 'published' ? null : 'not_published'
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [pending, startTransition] = useTransition();

  const published = review.status === 'published';
  const locked = pending || (blocked !== null && blocked !== 'not_published');
  const changed =
    spoiler !== review.hasSpoiler ||
    marks.some(
      (mark, index) =>
        mark.hide !== initial[index].hide || (mark.hide && mark.reason !== initial[index].reason)
    );
  const missing = missingReasonMessage(marks);
  const reportCount = reasons.reduce((sum, reason) => sum + reason.count, 0);

  const updateMark = (next: PhotoMark) =>
    setMarks(current => current.map(mark => (mark.id === next.id ? next : mark)));

  const handle = (result: ReportActionResult) => {
    if (result.kind === 'forbidden') router.replace('/forbidden');
    else if (result.kind === 'error') setSaveFailed(true);
    // 公開でなくなっていたら読み直す (今の状態と写真で作り直し、閉じるだけにする。page の key に状態が入っている)
    else if (result.kind === 'not_published') router.refresh();
    else setBlocked(result.kind);
  };

  const send = (
    outcome:
      | { outcome: 'keep' }
      | { outcome: 'hide'; reasonCode: ReviewReportReason; reasonNote: string | null }
  ) => {
    const decisions = toPhotoDecisions(marks, 'publish');
    if (!decisions) return;
    setSaveFailed(false);
    startTransition(async () => {
      // 書けた時はサーバーが通報の一覧へ redirect するので、戻ってくるのは書けなかった時だけ
      handle(
        await handleReportsAction({
          reviewId: review.id,
          submittedAt: review.submittedAt ?? '',
          title,
          reportIds,
          hasSpoiler: spoiler,
          photos: decisions,
          ...outcome,
        })
      );
    });
  };

  return (
    <article className="relative bg-surface lg:self-start lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line">
      {blocked === 'superseded' && (
        <Banner tone="danger" title="この口コミは状態が変わりました">
          開いている間に、投稿者が直して出し直したか削除したか、ほかの画面でこの通報が処理されました。一覧に戻って読み直してください。
          <Link
            href="/reports"
            className="mt-3 block w-fit rounded-xl border border-danger-ink bg-surface px-3 py-2 text-xs font-bold text-danger-ink"
          >
            ‹ 一覧に戻る
          </Link>
        </Banner>
      )}
      {blocked === 'photos_changed' && (
        <Banner tone="warning" title="写真が変わりました">
          開いている間に、投稿者が写真を足したか外しました。読み直して確かめてください。
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-3 block rounded-xl border border-warning bg-surface px-3 py-2 text-xs font-bold text-warning-ink"
          >
            ↻ 読み直す
          </button>
        </Banner>
      )}
      {blocked === 'not_published' && (
        <Banner tone="warning" title="この口コミは公開中ではありません">
          通報の後に、投稿者が直して出し直したか、ほかの操作で状態が変わりました (
          {reviewStateLabel(review.status)})。
          非公開にしたり直したりはできません。問題なしで閉じてください。
        </Banner>
      )}

      {/* 通報 (Figma 16-PC `88:467`) */}
      <section
        className="flex flex-col gap-3 border-b border-line-soft px-4 pt-5 pb-4 lg:px-6"
        aria-label="通報"
      >
        <p className="flex items-center gap-1.5">
          <span className="rounded bg-danger-surface px-1.5 py-0.5 text-[11px] font-bold text-danger">
            通報 {reportCount} 件
          </span>
          <span className="text-[11px] text-ink-muted">
            {reviewStateLabel(review.status)}
            {firstReportedLabel && ` ・ 最初の通報 ${firstReportedLabel}`}
          </span>
        </p>
        <h1 className="text-[13px] font-bold text-ink-strong">{title}</h1>
        <p className="text-[11px] text-ink-body">通報の理由: {reportReasonsLabel(reasons)}</p>
        {missing && <p className="text-xs font-bold text-danger-ink">{missing}</p>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            disabled={locked || missing !== null}
            onClick={() => send({ outcome: 'keep' })}
            className="rounded-xl border border-line-strong bg-surface px-6 py-3 font-display text-[13px] font-bold text-ink-body disabled:opacity-45"
          >
            {changed ? '直して公開のままにする' : '問題なしにする'}
          </button>
          {published && (
            <button
              type="button"
              disabled={locked || missing !== null}
              onClick={() => setHiding(true)}
              className="rounded-xl bg-danger px-6 py-3 font-display text-[13px] font-bold text-white disabled:opacity-45"
            >
              非公開にする
            </button>
          )}
        </div>
      </section>

      {/* 口コミ全体 (Figma 16-PC `88:481`)。ネタバレの印と写真の非公開はここで変える */}
      <section className="flex flex-col gap-2 px-4 pt-2 pb-6 lg:px-6" aria-label="口コミ全体">
        <h2 className="text-xs font-bold text-ink-strong">口コミ全体</h2>
        <p className="text-[11px] text-ink-muted">{authorName ?? '退会済みユーザー'}</p>
        <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 py-2 text-xs">
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
          <dt className="text-ink-muted">ネタバレ</dt>
          <dd>
            <label className="flex items-center gap-1.5 text-ink-strong">
              <input
                type="checkbox"
                checked={spoiler}
                disabled={locked || !published}
                onChange={event => setSpoiler(event.target.checked)}
                className="size-3.5 accent-danger-ink"
              />
              ネタバレを含む
            </label>
          </dd>
        </dl>
        <p className="text-[13px] whitespace-pre-wrap text-ink-body">{review.body}</p>

        {photos.length > 0 && (
          <div className="pt-2">
            <h3 className="text-xs font-bold text-ink-strong">写真 {photos.length} 枚</h3>
            <ul className="mt-2.5 grid grid-cols-3 gap-2 lg:flex lg:flex-wrap">
              {photos.map((photo, index) => {
                const mark = marks[index];
                return (
                  <li key={photo.id} className="flex min-w-0 flex-col gap-1.5 lg:w-[110px]">
                    <span
                      className={`relative block aspect-square w-full overflow-hidden rounded-[10px] bg-photo lg:size-[110px] ${
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
                    </span>
                    <PhotoMarkControls
                      mark={mark}
                      aiJudged
                      disabled={locked || !published}
                      onChange={updateMark}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {saveFailed && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-8 z-30 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-danger-ink px-4 py-3 text-sm font-bold text-white shadow-lg"
        >
          <span aria-hidden>!</span>
          保存できませんでした。もう一度お試しください。
        </div>
      )}
      {hiding && (
        <RejectDialog
          options={REPORT_REASON_OPTIONS}
          copy={HIDE_COPY}
          initialReason={reasons[0]?.code ?? null}
          pending={pending}
          onSubmit={(reasonCode, reasonNote) => {
            setHiding(false);
            send({ outcome: 'hide', reasonCode, reasonNote });
          }}
          onClose={() => setHiding(false)}
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

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'danger' | 'warning';
  title: string;
  children: React.ReactNode;
}) {
  const colors =
    tone === 'danger'
      ? 'border-danger bg-danger-surface text-danger-ink'
      : 'border-warning bg-warning-surface text-warning-ink';
  return (
    <div role="alert" className={`border-b px-4 py-3.5 lg:px-6 ${colors}`}>
      <p className="text-[13px] font-bold">{title}</p>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}
