/**
 * 投稿後の画面 (Figma #7 の右「投稿ステータス」)。提出 → 公開前の審査中 → 公開 の進み具合を出す。
 *
 * - 審査は応答の後に走るので、この画面では「審査中」までを出す。結果は開催ページの自分の口コミの欄で
 *   分かる (one-more-time #161 の PR④)
 * - Figma の注意書きのうち、マイページでの編集と写真の文は、それぞれのチケット (#162・#163) で足す
 * - X の共有は Figma に無いが、受け入れ基準にある (one-more-time #161)
 */

import Link from 'next/link';

type Props = {
  submittedAt: Date;
  eventName: string;
  venueName: string;
  occurrencePath: string;
  shareUrl: string;
};

/** 進み具合の点の色 (済み・今・これから) */
const STEP_DOT = {
  done: 'bg-primary-strong',
  current: 'bg-accent-yellow-deep',
  todo: 'bg-(--line-strong)',
} as const;

const DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function ReviewSubmitted(props: Props) {
  const steps = [
    { title: '投稿しました', note: DATE_TIME.format(props.submittedAt), state: 'done' },
    { title: '公開前審査中', note: '通常1時間以内に完了します', state: 'current' },
    { title: '公開', note: '開催ページに掲載されます', state: 'todo' },
  ] as const;

  return (
    <section aria-labelledby="review-status-heading" className="flex flex-col gap-4">
      <h2
        id="review-status-heading"
        className="text-center font-display text-base font-bold text-ink-strong"
      >
        投稿ステータス
      </h2>

      <ol className="rounded-2xl border border-(--line-soft) bg-white p-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
              <span
                aria-hidden="true"
                className={`size-3.5 rounded-full ${STEP_DOT[step.state]}`}
              />
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`min-h-8 w-0.5 flex-1 ${step.state === 'done' ? 'bg-primary-strong' : 'bg-(--line-soft)'}`}
                />
              )}
            </div>
            <div className={`pb-6 ${step.state === 'todo' ? 'text-ink-muted' : 'text-ink-strong'}`}>
              <p
                className="text-sm font-bold"
                aria-current={step.state === 'current' ? 'step' : undefined}
              >
                {step.title}
              </p>
              <p className="text-xs text-ink-muted">{step.note}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="rounded-xl border border-accent-yellow-deep/40 bg-accent-yellow/15 p-3 text-xs leading-relaxed text-ink-body">
        審査に通らなかった場合は、開催ページのあなたの口コミの欄に理由をお知らせします。
      </p>

      <a
        href={props.shareUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-2xl border border-primary-strong bg-white p-3.5 text-center font-display text-base font-bold text-primary-strong"
      >
        X で共有する
      </a>

      <Link
        href={props.occurrencePath}
        className="flex items-center gap-2 rounded-xl border border-(--line-soft) bg-white p-3"
      >
        <span className="flex-1">
          <span className="block text-xs text-ink-strong">
            {props.eventName} {props.venueName}
          </span>
          <span className="block text-xs text-ink-muted">開催ページに戻る</span>
        </span>
        <span aria-hidden="true" className="text-base text-primary-strong">
          ›
        </span>
      </Link>
    </section>
  );
}
