import Link from 'next/link';

import { getEventUrl } from '@/lib/event/event-url';
import type { EventListItem } from '@/lib/event/queries';

/**
 * `/events` と `/{種別}` の一覧の企画カード (Claude Design v6 #14)。
 *
 * 上から **作品チップ + イベントタイプタグ → 企画名 → 会場数と状態別内訳**。
 * 「何の作品の、どんな種類の企画で、今行けるのか」を 3 行で読ませる。
 *
 * ## データ源
 *
 * 3 要素すべて `listEventListItems` の拡張で取得したもの (v6 の
 * `▲ 要クエリ拡張`)。PR #333 では `events.name` のみだったため、旧実装の
 * カードは企画名 1 行だけだった。
 *
 * ## 出さないもの
 *
 * `description` / `official_url` は取得しているが一覧では使わない (v6 の注記どおり)。
 * 一覧の役目は「選ぶ」ことで、詳細は企画ページが持つ。
 */

type Props = {
  event: EventListItem;
  /**
   * タイプタグを出すか (既定は出す)。種別の一覧 (`/{種別}`) では全カードが見出しと
   * 同じ種別になり情報を持たないので出さない (2026-11-03 BOSS 確定)。
   */
  showTypeTag?: boolean;
};

export const EventSummaryCard = ({ event, showTypeTag = true }: Props) => (
  <Link
    href={getEventUrl(event)}
    className="block rounded-2xl border border-[var(--line-soft)] bg-bg-elevated p-3 shadow-sm transition-colors hover:border-primary-300"
  >
    {/*
      作品チップとタイプタグ。**タイプタグは 1 個** (`primary_category_id` は
      NOT NULL FK で、契約も non-null)、作品は 0 個以上 (複数作品コラボがある)。
      タイプタグを出さず作品も 0 件のときは、空の行を描かない。
    */}
    {(showTypeTag || event.titles.length > 0) && (
      <div className="flex flex-wrap items-center gap-1">
        {event.titles.map((title) => (
          <span
            key={title.slug}
            className="rounded-md bg-bg-tinted px-1.5 py-0.5 font-display text-xs text-primary-700"
          >
            {title.name}
          </span>
        ))}
        {showTypeTag && (
          <span className="rounded-md bg-tag-type px-2 py-0.5 font-display text-xs font-bold text-white">
            {event.primaryCategory.name}
          </span>
        )}
      </div>
    )}

    <p className="mt-2 font-display font-bold leading-snug text-ink-strong">{event.name}</p>

    {/*
      会場数と状態別内訳。0 件の状態は `summarizeStatusCounts` が落としているので、
      ここでは並べるだけ (「終了 0」のような無情報を出さない)。
      一覧に載る企画は必ず開催を 1 件以上持つ (`listEventParams` の定義) ため、
      この行が空になることはない。
    */}
    <p className="mt-1 text-xs text-ink-muted">
      全<span className="font-numeric tabular-nums">{event.occurrenceCount}</span>会場
      {event.statusCounts.length > 0 && (
        <>
          {' ・ '}
          {event.statusCounts.map((entry, index) => (
            <span key={entry.status}>
              {index > 0 && ' / '}
              {entry.label} <span className="font-numeric tabular-nums">{entry.count}</span>
            </span>
          ))}
        </>
      )}
    </p>
  </Link>
);

export default EventSummaryCard;
