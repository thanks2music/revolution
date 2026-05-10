/**
 * イベントステータスバッジ。
 * `--accent-yellow` の塗りはサイト内で本コンポーネントの 'coming-soon' / 'now'
 * 状態だけが発生源 (brief §4-1 の "事件性" シグナル一点突破)。
 */
export type EventStatus = 'coming-soon' | 'now' | 'ended' | 'unknown';

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
};

const labelByStatus: Record<EventStatus, string> = {
  'coming-soon': 'Coming Soon',
  now: '開催中',
  ended: '終了',
  unknown: '詳細を確認',
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
