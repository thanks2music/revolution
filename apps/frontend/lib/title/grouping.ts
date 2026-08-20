import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import type { Occurrence } from '@/lib/occurrence/queries';
import type { TitleEvent } from '@/lib/title/contracts';

/**
 * 作品ハブの「この作品の企画」を組み立てる (Layer 1、純粋関数)。
 *
 * ## 並び順の意図
 *
 * `lib/event/grouping.ts` (開催の状態グループ) と同じく**今行けるものを先に**。
 * 企画単位では代表状態 (その企画の開催のうち最も「行ける」状態) で並べ、
 * 同じ代表状態の中では **終了が新しい順** (`docs/event-review-data-model.md`
 * §4.4 の `order by max(o.ends_on) desc`)。常設・終了日未定
 * (`ends_on = null`) は「まだ終わっていない」ので新しい側 (先頭側) に置く。
 *
 * ## 公開済み開催を持たない企画は落とす
 *
 * `/events/{id}` の静的生成対象 (`listEventParams`) や関連企画
 * (`findRelatedEvents` の「空ページへリンクしない」) と同じ基準。
 * anon で見える開催 (`verified = true`) が 1 件も無い企画をハブに出すと、
 * リンクを踏んだ先の「会場を選ぶ」が空になる。
 */

export type TitleEventGroup = {
  event: TitleEvent;
  /** この企画の公開済み開催。状態優先 (今行けるものを先に)、同状態内は入力順 (starts_on 順)。 */
  occurrences: Occurrence[];
};

/**
 * 代表状態の優先順位。小さいほど先。`lib/event/grouping.ts` の GROUPS と同じ順。
 * `Record` で `OccurrenceStatus` との網羅一致を強制する (状態を足して
 * ここを忘れるとコンパイルエラー)。
 */
const STATUS_PRIORITY: Record<OccurrenceStatus, number> = {
  ongoing: 0,
  scheduled: 1,
  unscheduled: 2,
  ended: 3,
  cancelled: 4,
};

/** `ends_on = null` (常設・終了日未定) を「最も新しい終了日」として扱う番兵。 */
const OPEN_ENDED_SENTINEL = '9999-99-99';

function representativePriority(occurrences: Occurrence[]): number {
  return Math.min(...occurrences.map((occurrence) => STATUS_PRIORITY[occurrence.status]));
}

function latestEnd(occurrences: Occurrence[]): string {
  // `ends_on` は `YYYY-MM-DD` の ISO 文字列なので辞書順比較で足りる。
  return occurrences
    .map((occurrence) => occurrence.endsOn ?? OPEN_ENDED_SENTINEL)
    .reduce((max, value) => (value > max ? value : max), '');
}

/**
 * 企画と開催を突き合わせ、表示順に並んだグループへ。
 *
 * グループ内の開催も**状態優先**で並べる (終了した会場が開催中の会場より上に
 * 出ると「もう行けない選択肢」を先に読ませることになる)。同状態内は入力順
 * (クエリの `starts_on` 昇順) を保つ (sort は安定)。
 */
export function buildTitleEventGroups(
  events: readonly TitleEvent[],
  occurrences: readonly Occurrence[],
): TitleEventGroup[] {
  const byEventId = new Map<number, Occurrence[]>();
  for (const occurrence of occurrences) {
    const list = byEventId.get(occurrence.eventId);
    if (list) {
      list.push(occurrence);
    } else {
      byEventId.set(occurrence.eventId, [occurrence]);
    }
  }

  return events
    .flatMap((event) => {
      const items = byEventId.get(event.id);
      if (!items) return [];
      const sorted = [...items].sort(
        (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
      );
      return [{ event, occurrences: sorted }];
    })
    .sort((a, b) => {
      const byStatus = representativePriority(a.occurrences) - representativePriority(b.occurrences);
      if (byStatus !== 0) return byStatus;
      // 終了が新しい順 (降順)。同値なら入力順 (sort は安定)。
      return latestEnd(b.occurrences).localeCompare(latestEnd(a.occurrences));
    });
}
