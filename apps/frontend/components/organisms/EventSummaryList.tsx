import { EmptyState } from '@/components/molecules/EmptyState';
import { EventSummaryCard } from '@/components/molecules/EventSummaryCard';
import type { EventListItem } from '@/lib/event/queries';

/**
 * 企画カードの一覧 (件数 + グリッド)。0 件なら空状態を出す。
 *
 * `/events` (全種別) と `/{種別}` (種別ごと) の 2 画面で同じ見た目を使う。
 * 2 画面は同じ集合 (`listEventListItems`) を絞り方だけ変えて並べるので、
 * 片方だけ列数や件数の書き方が変わらないよう 1 つにした。
 */

type Props = {
  events: EventListItem[];
  /** 0 件のときの文言。 */
  emptyMessage: string;
};

export const EventSummaryList = ({ events, emptyMessage }: Props) =>
  events.length > 0 ? (
    <>
      <p className="mb-6 text-sm text-ink-muted">
        <span className="font-numeric tabular-nums">{events.length}</span> 件
      </p>

      <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3" data-grid-layout="block">
        {events.map((event) => (
          <li key={event.id}>
            <EventSummaryCard event={event} />
          </li>
        ))}
      </ul>
    </>
  ) : (
    <EmptyState message={emptyMessage} />
  );
