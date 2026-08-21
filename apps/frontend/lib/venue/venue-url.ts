/**
 * 会場ページの URL 生成 (Layer 1、純粋関数)。
 *
 * `lib/title/title-url.ts` / `lib/event/event-url.ts` と同じ慣習で、
 * 正準形の定義を生成側の 1 箇所に集約する。URL 設計は
 * `docs/event-review-data-model.md` §7 (`/venues/{slug}` = その会場の全開催。
 * 一覧に載る開催の canonical は本拠地 `/events/{id}/{occurrence-slug}` を指す)。
 */

/** 会場ページ。`/venues/{slug}` */
export function getVenueUrl(venueSlug: string): string {
  return `/venues/${venueSlug}`;
}
