import type { OccurrenceStatus } from '@revolution/schemas/occurrence';
import Link from 'next/link';

import { RemainingDaysBadge } from '@/components/atoms/badge/RemainingDaysBadge';
import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import { formatPeriod, formatPeriodTense } from '@/lib/occurrence/format';
import { toBadgeStatus } from '@/lib/occurrence/status';

/**
 * **企画名を主表示にした**開催カード (Claude Design v6 #16)。
 *
 * ## `OccurrenceCard` との違い
 *
 * `OccurrenceCard` は**会場名**が主表示で、企画ページ (`/events/{id}`) と
 * 作品ハブ (`/titles/{slug}`) が使う — どちらも「1 つの企画の中で会場を選ぶ」
 * 画面なので、行ごとに変わるのは会場名だから。
 *
 * こちらは逆で、**行ごとに変わるのが企画名**の画面が使う:
 *
 * | 画面 | 会場名 |
 * |---|---|
 * | `/venues/{slug}` (会場ページ) | ページ自身が会場なので**渡さない** |
 * | `/titles/{slug}/occurrences` (作品の開催一覧) | 企画も会場も変わるので**渡す** |
 *
 * ## 共通化した経緯 (rule-of-3 を満たしている)
 *
 * 会場ページ (#333) が「`OccurrenceCard` は流用しない — あちらの主表示は会場名で、
 * 会場ページでは全行が同じ名前になり無意味」としてカードをインラインで持ち、
 * docstring に **「3 つ目のページが来た時点で再判定する」** と書いていた。
 * v6 #16 がその 3 つ目なので、宣言どおり共通化した。
 *
 * ## 状態ごとの地色
 *
 * 終了はアーカイブ地 (沈んだクリーム)、中止は通常地 + 文字を落とす。
 * 「もう行けない」ことを彩度で示し、開催中・予定のカードを前に出す。
 */

type Props = {
  eventId: number;
  /** 開催の slug (`/events/{id}/{slug}` のリンク先)。 */
  slug: string;
  /** 主表示。解決済みの企画名を渡す (fallback の判断は呼び出し側の契約層が持つ)。 */
  eventName: string;
  status: OccurrenceStatus;
  startsOn: string | null;
  endsOn: string | null;
  /**
   * 従表示の会場名。**会場ページでは渡さない** (全行が同じ名前になり無意味)。
   * 会場マスタも `venue_label` も無い開催では null になり得るので、その場合も出さない。
   */
  venueName?: string | null;
};

/** 状態ごとのカードの地色・罫線・文字色。 */
const surfaceStyle: Record<OccurrenceStatus, string> = {
  ongoing: 'border-[var(--line-soft)] bg-bg-elevated',
  scheduled: 'border-[var(--line-soft)] bg-bg-elevated',
  unscheduled: 'border-[var(--line-soft)] bg-bg-elevated',
  // 終了はアーカイブのトーンへ沈める。
  ended: 'border-archive-line bg-archive',
  // 中止は地を変えず文字を落とす (「予定が消えた」ことを彩度で示す)。
  cancelled: 'border-[var(--line-soft)] bg-bg-elevated',
};

const bodyStyle: Record<OccurrenceStatus, string> = {
  ongoing: 'text-ink-muted',
  scheduled: 'text-ink-muted',
  unscheduled: 'text-ink-muted',
  ended: 'text-archive-ink',
  cancelled: 'text-ink-muted/70',
};

const titleStyle: Record<OccurrenceStatus, string> = {
  ongoing: 'text-ink-strong',
  scheduled: 'text-ink-strong',
  unscheduled: 'text-ink-strong',
  ended: 'text-archive-ink',
  cancelled: 'text-ink-muted',
};

export const EventOccurrenceCard = ({
  eventId,
  slug,
  eventName,
  status,
  startsOn,
  endsOn,
  venueName,
}: Props) => (
  <Link
    href={getOccurrenceUrl(eventId, slug)}
    className={`block rounded-2xl border p-3 shadow-sm transition-colors hover:border-primary-300 ${surfaceStyle[status]}`}
  >
    <div className="flex flex-wrap items-center gap-1">
      <StatusBadge status={toBadgeStatus(status)} />
      {/*
        残日数は **開催中のときだけ**出す。「あと N 日」は `ends_on` までの
        日数 = 「行ける残り時間」で、開催前に出すと「開始まであと N 日」と
        読まれて意味が反転する (`OccurrenceCard` と同じ理由)。
      */}
      {status === 'ongoing' && <RemainingDaysBadge endsOn={endsOn} />}
    </div>

    <p className={`mt-2 font-display font-bold leading-snug ${titleStyle[status]}`}>{eventName}</p>

    <p className={`mt-1 text-xs leading-relaxed ${bodyStyle[status]}`}>
      {venueName && (
        <>
          {venueName}
          <br />
        </>
      )}
      <span className="font-numeric tabular-nums">{formatPeriod(startsOn, endsOn)}</span>
      {formatPeriodTense(status)}
    </p>
  </Link>
);

export default EventOccurrenceCard;
