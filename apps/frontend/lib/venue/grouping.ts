import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import { OCCURRENCE_STATUS_LABELS } from '@/lib/occurrence/status';
import type { VenueOccurrence } from '@/lib/venue/contracts';

/**
 * 会場ページで開催を状態別にまとめる (Layer 1、純粋関数)。
 *
 * ## `lib/event/grouping.ts` を流用しない理由
 *
 * 状態の順序・見出し・グループ内の並び規則 (`GROUPS`) はあちらと同じだが、
 * タイブレークが違う。既存 `groupOccurrencesByStatus` は `venueName ?? slug` で
 * 並べるが、**会場ページでは venueName が定数** (全行が同じ会場) で、開催 slug も
 * 会場 slug と同値になる運用 (§7 案 B) のため退化する。会場ページで意味を持つ
 * 名前は**企画名**なので、そちらでタイブレークする専用モジュールを置く
 * (`lib/title/grouping.ts` が作品専用の grouping を持つのと同じ前例。
 * 共有テスト済みコードに名前セレクタ引数を生やす一般化は 2 例目では行わない)。
 *
 * ## 並び順の意図 (`lib/event/grouping.ts` と同一)
 *
 * **今行けるものを先に**出す。開催中 → 開催予定 → 日程未発表 → 終了 → 中止。
 * 空のグループは返さない (見出しだけのセクションを出さない)。
 */

export type VenueOccurrenceGroup = {
  key: OccurrenceStatus;
  /** 見出し。状態バッジの文言とは別に、セクション名として読ませる。 */
  label: string;
  items: VenueOccurrence[];
};

/**
 * グループ内の並びに使う日付。
 *
 * ⚠️ **中止と日程未発表を日付で並べてはいけない** (`lib/event/grouping.ts` の
 *    注記と同じ理由)。この 2 状態は `name` = 企画名順。
 */
type WithinOrder = 'ends-asc' | 'starts-asc' | 'name';

/**
 * 表示順 + グループ内の並び。**配列の順序がそのまま画面の順序**。
 * 見出しラベルは `OCCURRENCE_STATUS_LABELS` (`lib/occurrence/status.ts`) が SSoT。
 * 網羅性は `MissingGroup` がコンパイル時に守る (状態を足してここを忘れると
 * 型エラー。`lib/event/grouping.ts` と同じ仕組み)。
 */
const GROUPS = [
  { key: 'ongoing', within: 'ends-asc' },
  { key: 'scheduled', within: 'starts-asc' },
  { key: 'unscheduled', within: 'name' },
  { key: 'ended', within: 'ends-asc' },
  { key: 'cancelled', within: 'name' },
] as const satisfies readonly { key: OccurrenceStatus; within: WithinOrder }[];

// 網羅漏れをコンパイル時に検出する。状態を足して GROUPS に書き忘れると型エラー。
type MissingGroup = Exclude<OccurrenceStatus, (typeof GROUPS)[number]['key']>;
const _assertAllStatusesGrouped: MissingGroup extends never ? true : never = true;
void _assertAllStatusesGrouped;

/**
 * グループ内の並び。null 日付は末尾へ回し、同着は企画名 → id で安定させる
 * (id まで見るのは同一企画の複数開催が同じ会場・同じ日付で並び得るため)。
 */
function compareWithin(within: WithinOrder) {
  return (a: VenueOccurrence, b: VenueOccurrence): number => {
    const byName = () => a.eventName.localeCompare(b.eventName, 'ja') || a.id - b.id;

    if (within === 'name') return byName();

    const left = within === 'starts-asc' ? a.startsOn : a.endsOn;
    const right = within === 'starts-asc' ? b.startsOn : b.endsOn;

    if (left !== right) {
      if (left === null) return 1; // 日付なしは後ろ
      if (right === null) return -1;
      return left < right ? -1 : 1;
    }

    // 同着 / 日付なし同士は企画名で安定させる (実行ごとに順序が変わらないように)。
    return byName();
  };
}

/** 開催を状態別のグループへまとめる。空のグループは含まない。 */
export function groupVenueOccurrencesByStatus(items: VenueOccurrence[]): VenueOccurrenceGroup[] {
  return GROUPS.map(({ key, within }) => ({
    key,
    label: OCCURRENCE_STATUS_LABELS[key],
    items: items.filter((item) => item.status === key).sort(compareWithin(within)),
  })).filter((group) => group.items.length > 0);
}
