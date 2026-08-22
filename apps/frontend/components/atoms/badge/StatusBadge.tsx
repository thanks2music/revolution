/**
 * イベントステータスバッジ。
 *
 * ## 意匠 (Claude Design v6、2026-08-22 全面変更)
 *
 * **ピル型 (角丸 full) + 塗り分け**。開催中だけが濃色 + 白文字 + ライブドットで、
 * 残りは淡色 + 暗文字。「今行ける」ものが一目で立つ階層にしている。
 *
 * ⚠️ **v5 の「黄色塗り一点突破」は撤回された。** 旧実装は `--accent-yellow` の
 *    塗りを 'coming-soon' / 'now' に当て、それをサイト内で唯一の発生源として
 *    "事件性" シグナルにしていた (brief §4-1)。v6 では開催中が青 (濃) になり、
 *    黄色は**残日数バッジ (`RemainingDaysBadge`) と 'coming-soon' の「あと N 日」
 *    大数字**に残る。BOSS 承認済みの意図的な変更 (2026-08-22)。
 *
 * 🔶 v6 の開催中の指定色 `#0B93D5` は白文字とのコントラストが 3.42:1 で
 *    WCAG AA (4.5:1) を割るため、**色相を変えず既存の `--primary-strong`
 *    (#1a6fa3、5.46:1)** を使う。終了バッジの文字も同様に是正済み。
 *    経緯は `styles/globals.css` のトークン定義を参照。
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

const baseStyle =
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-sm tracking-wide';

const variantStyle: Record<EventStatus, string> = {
  // 開催予定。淡色 + 暗文字 (6.43:1)。「まだ行けない」ので開催中より沈ませる。
  'coming-soon': 'bg-status-scheduled-surface text-status-scheduled-ink',
  // 開催中。唯一の濃色 + 白文字 (5.46:1)。ライブドットは下の分岐で足す。
  now: 'bg-status-ongoing text-white',
  // 終了。アーカイブのトーンに合わせた地 + 暗文字 (5.03:1)。
  ended: 'bg-status-ended-surface text-status-ended-ink',
  unknown: 'bg-bg-tinted text-ink-muted border border-[var(--line-soft)]',
  // 「発表待ち」を表すので、終了 (沈んだ地) とも開催中 (濃色) とも別に見えること。
  // 塗らず破線のみにして「まだ確定していない」を視覚的に表す (v6 が唯一の
  // 新規トークンと呼ぶ --status-unscheduled-line)。
  unscheduled:
    'bg-transparent text-status-scheduled-ink border border-dashed border-status-unscheduled-line',
  // 中止。淡赤地 + 赤文字 (5.18:1)。白文字は載せない。
  cancelled: 'bg-status-cancelled-surface text-status-cancelled',
};

const labelByStatus: Record<EventStatus, string> = {
  'coming-soon': 'Coming Soon',
  now: '開催中',
  ended: '終了',
  unknown: '詳細を確認',
  // grouping のセクション見出し (`OCCURRENCE_STATUS_LABELS`) と v6 の表記に揃えた
  // (旧 '日程未定'。同じ状態を 2 つの言葉で呼んでいた)。
  unscheduled: '日程未発表',
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

  if (status === 'now') {
    return (
      <span className={cls}>
        {/*
          ライブドット。`motion-safe:` により prefers-reduced-motion: reduce では
          点滅せず静的なドットになる (a11y)。「開催中」は色・文言・位置で既に
          伝わっており、点滅は装飾なので止まっても情報は失われない。
        */}
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-white motion-safe:animate-[livePulse_1.6s_ease-in-out_infinite]"
        />
        {labelByStatus[status]}
      </span>
    );
  }

  return <span className={cls}>{labelByStatus[status]}</span>;
};

export default StatusBadge;
