import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import type { OccurrenceListItem } from '@/lib/occurrence/queries';

/**
 * 企画ページの「会場を選ぶ」で開催を状態別にまとめる (Layer 1、純粋関数)。
 *
 * ## 並び順の意図
 *
 * **今行けるものを先に**出す。開催中 → 開催予定 → 日程未定 → 終了 → 中止。
 * 終了・中止を上に置くと「もう行けない選択肢」を先に読ませることになる。
 *
 * 日程未定を終了より前に置いているのは、**まだ行ける可能性がある**ため
 * (`unscheduled` は欠損ではなく「主催者が日程を発表していない」正規の状態、
 * 2026-08-09 確定)。
 *
 * ## 空のグループは返さない
 *
 * 見出しだけあって中身が無いセクションを画面に出さないため、呼び出し側で
 * 判定させず**ここで落とす**。
 */

/** 表示上のまとまり。`occurrence_view` の 5 状態と 1:1。 */
export type OccurrenceGroupKey = OccurrenceStatus;

export type OccurrenceGroup = {
  key: OccurrenceGroupKey;
  /** 見出し。状態バッジの文言とは別に、セクション名として読ませる。 */
  label: string;
  items: OccurrenceListItem[];
};

/** 表示順。配列の順序がそのまま画面の順序になる。 */
const GROUP_ORDER: { key: OccurrenceGroupKey; label: string }[] = [
  { key: 'ongoing', label: '開催中' },
  { key: 'scheduled', label: '開催予定' },
  { key: 'unscheduled', label: '日程未発表' },
  { key: 'ended', label: '終了' },
  { key: 'cancelled', label: '中止' },
];

/**
 * グループ内の並び。
 *
 * - 開催中 / 終了: **終わりが近い順** (`ends_on` 昇順)。終了間近を上に出す
 * - 開催予定: **始まるのが早い順** (`starts_on` 昇順)
 * - 日程未定 / 中止: 日付が無い / 意味を持たないので会場名で安定させる
 *
 * ⚠️ `ends_on` は null (終了日未定 / 常設) を取り得るので、null は末尾へ回す。
 *    比較関数で null を 0 や Infinity に潰すと、常設が先頭に来たり
 *    ソートが不安定になったりする。
 */
function compareWithin(key: OccurrenceGroupKey) {
  return (a: OccurrenceListItem, b: OccurrenceListItem): number => {
    const byDate = (left: string | null, right: string | null): number | null => {
      if (left === right) return null;
      if (left === null) return 1; // 日付なしは後ろ
      if (right === null) return -1;
      return left < right ? -1 : 1;
    };

    const primary =
      key === 'scheduled' ? byDate(a.startsOn, b.startsOn) : byDate(a.endsOn, b.endsOn);
    if (primary !== null) return primary;

    // 同着 / 日付なし同士は表示名で安定させる (実行ごとに順序が変わらないように)。
    return (a.venueName ?? a.slug).localeCompare(b.venueName ?? b.slug, 'ja');
  };
}

/** 開催を状態別のグループへまとめる。空のグループは含まない。 */
export function groupOccurrencesByStatus(items: OccurrenceListItem[]): OccurrenceGroup[] {
  return GROUP_ORDER.map(({ key, label }) => ({
    key,
    label,
    items: items.filter((item) => item.status === key).sort(compareWithin(key)),
  })).filter((group) => group.items.length > 0);
}
