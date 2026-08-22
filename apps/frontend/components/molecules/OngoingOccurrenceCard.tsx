import Link from 'next/link';

import { RemainingDaysBadge } from '@/components/atoms/badge/RemainingDaysBadge';
import { StatusBadge } from '@/components/atoms/badge/StatusBadge';
import { getOccurrenceUrl } from '@/lib/event/event-url';
import type { OngoingOccurrence } from '@/lib/home/contracts';
import { formatPeriod } from '@/lib/occurrence/format';

/**
 * トップの「開催中」rail に並ぶカード (Claude Design v5 #1)。
 *
 * ## 他の開催カードとの違い
 *
 * | コンポーネント | 主表示 | 使う画面 |
 * |---|---|---|
 * | `OccurrenceCard` | 会場名 | 企画ページ / 作品ハブ (1 企画の中で会場を選ぶ) |
 * | `EventOccurrenceCard` | 企画名 | 会場ページ / 作品の開催一覧 |
 * | **本コンポーネント** | 企画名 + **会場名を連結** | トップ (軸が無い) |
 *
 * トップの rail は**企画も会場も作品も揃っていない状態**で 1 枚を見せるため、
 * v5 は「呪術廻戦 × OH MY CAFE 渋谷パルコ」のように**企画名と会場名を 1 行に
 * 連結**して「何が・どこで」を一目で成立させている。他の 3 種と主表示の作りが
 * 違うので共通化せず独立させた。
 *
 * ## v5 にあるが置かないもの
 *
 * `event photo` (画像列なし) / 星評価 (S4) / 補助タグ「物販あり」「要予約」
 * (`event_attributes` は MVP スコープ外)。データ源が無いものは描かない。
 */

type Props = {
  occurrence: OngoingOccurrence;
};

export const OngoingOccurrenceCard = ({ occurrence }: Props) => (
  <Link
    href={getOccurrenceUrl(occurrence.eventId, occurrence.slug)}
    className="flex w-[17rem] shrink-0 flex-col gap-2 rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
  >
    <div className="flex flex-wrap items-center gap-1">
      {/*
        `status` は問い合わせで `ongoing` に絞ってあるので、バッジは固定で「開催中」。
        残日数は `ends_on` が近いほど強い色になる (`RemainingDaysBadge` の 3 段階)
        ので、v5 の「もうすぐ終了」の役割はそちらが担う。
      */}
      <StatusBadge status="now" />
      <RemainingDaysBadge endsOn={occurrence.endsOn} />
    </div>

    {occurrence.titles.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {occurrence.titles.map((title) => (
          <span
            key={title.slug}
            className="rounded-md bg-bg-tinted px-1.5 py-0.5 font-display text-xs text-primary-700"
          >
            {title.name}
          </span>
        ))}
      </div>
    )}

    {/*
      企画名 + 会場名。会場マスタが無い開催 (オンライン等) では企画名だけになる。
      `line-clamp-2` で 2 行に抑え、rail のカード高さを揃える。
    */}
    <p className="line-clamp-2 font-display font-bold leading-snug text-ink-strong">
      {occurrence.venueName ? `${occurrence.eventName} ${occurrence.venueName}` : occurrence.eventName}
    </p>

    {occurrence.categoryName && (
      <span className="w-fit rounded-md bg-tag-type px-2 py-0.5 font-display text-xs font-bold text-white">
        {occurrence.categoryName}
      </span>
    )}

    <p className="mt-auto text-xs leading-relaxed text-ink-muted">
      {occurrence.venueRegion && (
        <>
          {occurrence.venueRegion}
          <br />
        </>
      )}
      <span className="font-numeric tabular-nums">
        {formatPeriod(occurrence.startsOn, occurrence.endsOn)}
      </span>
    </p>
  </Link>
);

export default OngoingOccurrenceCard;
