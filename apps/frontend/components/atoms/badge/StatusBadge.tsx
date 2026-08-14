/**
 * イベントステータスバッジ。
 * `--accent-yellow` の塗りはサイト内で本コンポーネントの 'coming-soon' / 'now'
 * 状態だけが発生源 (brief §4-1 の "事件性" シグナル一点突破)。
 *
 * ---
 *
 * `EventStatus` が表現できる状態。
 *
 * 内訳は **記事側 4 + 開催側 2** で、由来が違う:
 *
 * | 値 | 由来 | 使う場所 |
 * |---|---|---|
 * | `coming-soon` / `now` / `ended` | 記事 frontmatter の日付から導出 | EventFactCard / 開催ページ |
 * | `unknown` | 記事に日付が無い (「詳細を確認」) | **EventFactCard のみ** |
 * | `unscheduled` | `occurrences.starts_on is null` (日程未発表) | **開催ページのみ** |
 * | `cancelled` | `occurrences.cancelled_at` が入っている | **開催ページのみ** |
 *
 * `unknown` と `unscheduled` は紛らわしいが**別物**。前者は「記事から読み取れない」、
 * 後者は「主催者が日程をまだ発表していない」で、後者は欠損ではなく**正規の状態**
 * (2026-08-09 確定、`revolution-article-meta.md` §2.2)。
 *
 * ⚠️ 開催ページ側は `occurrence_view.status` の 5 値をここへ写像する。写像は
 *    `lib/occurrence/status.ts` の `toBadgeStatus()` に集約されており、
 *    view に値が増えたら**型エラーで気づける**ようにしてある。
 */
export type EventStatus =
  | 'coming-soon'
  | 'now'
  | 'ended'
  | 'unknown'
  | 'unscheduled'
  | 'cancelled';

type Props = {
  status: EventStatus;
  /** 'coming-soon' のとき「あと N 日」を数字で前面に出す */
  daysLeft?: number;
  className?: string;
};

const baseStyle = 'inline-flex items-center gap-1.5 px-3 py-1.5 font-display text-sm tracking-wide';

const YELLOW = 'bg-accent-yellow text-ink-strong border-l-[3px] border-accent-yellow-deep';

const variantStyle: Record<EventStatus, string> = {
  'coming-soon': YELLOW,
  now: YELLOW,
  ended: 'bg-ink-muted text-white',
  unknown: 'bg-bg-tinted text-ink-muted border border-[var(--line-soft)]',
  // 「発表待ち」を表すので、終了 (沈んだ色) とも開催中 (黄色) とも別に見えること。
  // 塗らず罫線のみにして「まだ確定していない」を視覚的に表す。
  unscheduled: 'bg-transparent text-ink-body border border-[var(--line-strong)] border-dashed',
  // 中止。白文字とのコントラスト 5.96:1 (AA PASS)。
  cancelled: 'bg-status-cancelled text-white',
};

const labelByStatus: Record<EventStatus, string> = {
  'coming-soon': 'Coming Soon',
  now: '開催中',
  ended: '終了',
  unknown: '詳細を確認',
  unscheduled: '日程未定',
  cancelled: '中止',
};

export const StatusBadge = ({ status, daysLeft, className = '' }: Props) => {
  const cls = `${baseStyle} ${variantStyle[status]} ${className}`;

  if (status === 'coming-soon' && typeof daysLeft === 'number' && daysLeft >= 0) {
    return (
      <span className={cls}>
        <span className="text-xs">あと</span>
        <span className="font-numeric tabular-nums text-xl font-black leading-none">
          {daysLeft}
        </span>
        <span className="text-xs">日</span>
      </span>
    );
  }

  return <span className={cls}>{labelByStatus[status]}</span>;
};

export default StatusBadge;
