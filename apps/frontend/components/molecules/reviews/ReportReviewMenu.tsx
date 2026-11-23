'use client';

/**
 * 口コミの「…」と通報 (one-more-time #168)。Figma に画面が無いので、管理アプリの差し戻しの理由 (Figma 15) と
 * 同じ形にした: スマホは下から出る板、PC は中央のモーダル。8 つの理由から 1 つ選んで送る。自由記述は無い。
 *
 * - ログインしていなくても通報できる (送り先の Server Action が端末の cookie で人をまとめる)
 * - 本人の口コミには出さない。閲覧者の状態を読み終えるまでは出さない (`useCanReport`)
 * - 送ったら「受け付けました」に変える。同じ人が何度送っても通報は 1 件にまとまる
 */

import { MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';

import { reportReview } from '@/actions/review-report';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { REPORT_REASON_LABELS } from '@revolution/reviews/labels';
import {
  REVIEW_REPORT_REASONS,
  type ReviewReportReason,
} from '@revolution/schemas/review-constants';

import { useCanReport } from './HelpfulButton';

type Step = 'choose' | 'sending' | 'done';

export function ReportReviewMenu({
  reviewId,
  authorName,
}: {
  reviewId: number;
  authorName: string;
}) {
  const canReport = useCanReport(reviewId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);

  if (!canReport) return null;

  function openDialog() {
    // 受け付けた後に開き直したら、受け付けた知らせのまま見せる (同じ人の通報はまとめられる)
    if (step !== 'done') {
      setReason(null);
      setStep('choose');
    }
    setError(null);
    setOpen(true);
  }

  async function submit() {
    if (!reason) return;
    setStep('sending');
    setError(null);
    try {
      const result = await reportReview(reviewId, reason);
      if (result.ok) {
        setStep('done');
      } else {
        setStep('choose');
        setError(result.error);
      }
    } catch {
      setStep('choose');
      setError('送れませんでした。通信を確かめて、もう一度お試しください');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${authorName}さんの口コミのメニュー`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-muted"
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={openDialog}>通報する</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="report-dialog"
          className="top-auto bottom-0 left-0 max-w-none translate-x-0 translate-y-0 gap-0 rounded-b-none bg-white px-4 pt-5 pb-6 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:px-6"
        >
          {step === 'done' ? (
            <div className="flex flex-col gap-2 pr-6">
              <DialogTitle className="text-[15px] font-bold text-ink-strong">
                受け付けました
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-ink-body">
                ご協力ありがとうございます。運営が内容を確かめ、投稿ガイドラインに沿っていなければ非公開にします。
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogTitle className="pr-6 text-[15px] font-bold text-ink-strong">
                この口コミを通報する
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-ink-muted">
                当てはまる理由を 1 つ選んでください
              </DialogDescription>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="通報の理由">
                {REVIEW_REPORT_REASONS.map(value => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={reason === value}
                    onClick={() => setReason(value)}
                    className={`rounded-full border px-3.5 py-2 text-[13px] transition-colors ${
                      reason === value
                        ? 'border-primary-strong bg-primary-50 font-bold text-primary-strong'
                        : 'border-(--line-strong) bg-white text-ink-body'
                    }`}
                  >
                    {REPORT_REASON_LABELS[value]}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="mt-3 text-xs text-status-cancelled">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={!reason || step === 'sending'}
                onClick={submit}
                className="mt-5 w-full rounded-xl bg-primary-strong py-3 text-sm font-bold text-white hover:bg-primary-strong-hover disabled:opacity-45"
              >
                {step === 'sending' ? '送っています…' : '通報する'}
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
