/**
 * Decide whether an event is skipped because its details are not announced yet (A-1-c).
 *
 * An article is not written for an event that is announced but has no details yet.
 * The rules (decided 2026-11-14):
 *
 * - Schedule: the start date must be known. An event whose end date alone is undecided
 *   is still written. With several venues, one venue with a start date is enough.
 *   No start date means either the first announcement only (no venue either) or
 *   "venue known, dates unknown".
 * - Items: at least one of the items the event type needs must be announced.
 *   - pop-up store: goods
 *   - exhibition: novelty or goods (exhibition content is not extracted yet)
 *   - collabo cafe, chain store, other: menu, goods or novelty
 *
 * An empty item list is treated as "not announced". The extraction has no flag that
 * tells "not announced" apart from "could not be read", so a failed read also leads to
 * a skip. That fails safe: the article is not written with guessed content, and the
 * reason reaches Slack so a person can run it again.
 *
 * The schedule check runs right after detail extraction (before the paid subpage and
 * Vision steps). The item check runs after Vision, when all three sources have been
 * merged, and before duplication-check (so no Firestore record is left behind).
 */
import type { ExtractionResult } from '@/lib/services/extraction.service';
import { isEmptyList } from '@/lib/utils/llm-values';
import { validateVenueLabel } from '@/lib/utils/venue-label-validator';

type ScheduleFields = Pick<ExtractionResult, '店舗名' | '開催期間' | 'event_data'>;
type ItemFields = Pick<
  ExtractionResult,
  'メニュー詳細リスト' | '具体的なメニュー名リスト' | 'グッズ名' | 'グッズ詳細リスト' | 'ノベルティ名'
>;

export type ItemCategory = 'menu' | 'goods' | 'novelty';

const ITEM_LABELS: Record<ItemCategory, string> = {
  menu: 'メニュー',
  goods: 'グッズ',
  novelty: 'ノベルティ',
};

/** The item categories that can make an article worth writing, per event type slug */
const REQUIRED_ANY: Record<string, readonly ItemCategory[]> = {
  'pop-up-store': ['goods'],
  exhibition: ['novelty', 'goods'],
};
const DEFAULT_REQUIRED_ANY: readonly ItemCategory[] = ['menu', 'goods', 'novelty'];

/** "N月N日" with digits. An empty string or words such as 後日発表 do not count */
const hasDate = (value: string | null | undefined): boolean =>
  typeof value === 'string' && /\d{1,2}\s*月\s*\d{1,2}\s*日/.test(value);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** True when any occurrence in the raw `event_data` has a start date */
function someOccurrenceHasStart(eventData: unknown): boolean {
  if (typeof eventData !== 'object' || eventData === null) return false;
  const occurrences = (eventData as { occurrences?: unknown }).occurrences;
  if (!Array.isArray(occurrences)) return false;
  return occurrences.some(
    (o) =>
      typeof o === 'object' &&
      o !== null &&
      typeof (o as { starts_on?: unknown }).starts_on === 'string' &&
      ISO_DATE.test((o as { starts_on: string }).starts_on)
  );
}

/**
 * @returns the skip reason when the start date is not announced, otherwise `undefined`
 */
export function unannouncedScheduleReason(extraction: ScheduleFields): string | undefined {
  if (hasDate(extraction.開催期間?.開始?.日付) || someOccurrenceHasStart(extraction.event_data)) {
    return undefined;
  }

  const venue = extraction.店舗名 ?? '';
  const venueKnown = venue.trim().length > 0 && validateVenueLabel(venue) === null;
  return venueKnown
    ? `詳細未発表のためスキップ: 開催日程が未発表 (会場「${venue}」は発表済み、開始日が無い)`
    : '詳細未発表のためスキップ: 第一報のみ (会場も開催日程も未発表)';
}

/** Which item categories have at least one item after all extraction steps */
export function announcedItemCategories(extraction: ItemFields): ItemCategory[] {
  const announced: ItemCategory[] = [];
  if (!isEmptyList(extraction.メニュー詳細リスト) || !isEmptyList(extraction.具体的なメニュー名リスト)) {
    announced.push('menu');
  }
  if (!isEmptyList(extraction.グッズ名) || !isEmptyList(extraction.グッズ詳細リスト)) {
    announced.push('goods');
  }
  if (!isEmptyList(extraction.ノベルティ名)) announced.push('novelty');
  return announced;
}

/**
 * @param eventType the resolved event type slug (`collabo-cafe`, `pop-up-store`, ...)
 * @returns the skip reason when none of the items the event type needs is announced,
 *   otherwise `undefined`
 */
export function unannouncedItemsReason(eventType: string, extraction: ItemFields): string | undefined {
  const required = REQUIRED_ANY[eventType] ?? DEFAULT_REQUIRED_ANY;
  const announced = announcedItemCategories(extraction);
  if (required.some((category) => announced.includes(category))) return undefined;

  const requiredLabel = required.map((c) => ITEM_LABELS[c]).join('・');
  const missing = required.length === 1 ? `${requiredLabel}が発表されていない` : `${requiredLabel}のどれも発表されていない`;
  const announcedLabel = announced.length > 0 ? announced.map((c) => ITEM_LABELS[c]).join('・') : 'なし';
  return (
    `詳細未発表のためスキップ: ${missing} ` +
    `(種別 ${eventType}、発表済みの品目: ${announcedLabel})`
  );
}
