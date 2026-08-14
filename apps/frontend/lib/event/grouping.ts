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

/**
 * グループ内の並びに使う日付。
 *
 * - `ends-asc`: 終わりが近い順。開催中 / 終了で「終了間近」を上に出す
 * - `starts-asc`: 始まるのが早い順
 * - `name`: 日付を並び順に使わない。**日程未発表と中止がこれ**
 *
 * ⚠️ **中止と日程未発表を日付で並べてはいけない。** 中止は `ends_on` を持ち得るし
 *    (`cancelled_at` があれば日付に関わらず中止)、日程未発表も DB CHECK 上は
 *    `starts_on is null` かつ `ends_on` あり を許す。日付で並べると
 *    「中止なのに終了間近が上」という無意味な順序になる。
 */
type WithinOrder = 'ends-asc' | 'starts-asc' | 'name';

/**
 * 表示順 + 見出し + グループ内の並び。配列の順序がそのまま画面の順序になる。
 *
 * ## 網羅性を型で守る
 *
 * `Record<OccurrenceGroupKey, ...>` で全状態の定義を強制し、そこから配列を作る。
 * こうしないと **zod enum と `toBadgeStatus` (コンパイラが強制する) だけ直して
 * ここを忘れる**ことができ、その状態の開催が「会場を選ぶ」から無言で落ちて
 * 件数表示 (`occurrences.length`) とグループ内合計が食い違う
 * (PR #303 レビュー指摘)。`toBadgeStatus` が `never` 代入で守っているのと同じ強度に揃える。
 */
const GROUP_DEFINITIONS: Record<OccurrenceGroupKey, { label: string; within: WithinOrder }> = {
  ongoing: { label: '開催中', within: 'ends-asc' },
  scheduled: { label: '開催予定', within: 'starts-asc' },
  unscheduled: { label: '日程未発表', within: 'name' },
  ended: { label: '終了', within: 'ends-asc' },
  cancelled: { label: '中止', within: 'name' },
};

/**
 * 画面に出す順。**`GROUP_DEFINITIONS` の全キーを列挙する必要がある**ことを
 * 型で保証したいので、下の `assertExhaustive` で漏れを検出する。
 */
const GROUP_ORDER = [
  'ongoing',
  'scheduled',
  'unscheduled',
  'ended',
  'cancelled',
] as const satisfies readonly OccurrenceGroupKey[];

// 表示順の列挙漏れをコンパイル時に検出する。`GROUP_DEFINITIONS` に状態を足して
// `GROUP_ORDER` に足し忘れると、ここで型エラーになる。
type MissingFromOrder = Exclude<OccurrenceGroupKey, (typeof GROUP_ORDER)[number]>;
const _assertAllStatusesOrdered: MissingFromOrder extends never ? true : never = true;
void _assertAllStatusesOrdered;

/**
 * グループ内の並び。`WithinOrder` の定義どおりに比較する。
 *
 * ⚠️ `starts_on` / `ends_on` はどちらも null を取り得るので、**null は末尾へ回す**。
 *    比較関数で null を 0 や Infinity に潰すと、常設 (`ends_on = null`) が
 *    先頭に来たりソートが不安定になったりする。
 */
function compareWithin(within: WithinOrder) {
  return (a: OccurrenceListItem, b: OccurrenceListItem): number => {
    const byName = () => (a.venueName ?? a.slug).localeCompare(b.venueName ?? b.slug, 'ja');

    if (within === 'name') return byName();

    const left = within === 'starts-asc' ? a.startsOn : a.endsOn;
    const right = within === 'starts-asc' ? b.startsOn : b.endsOn;

    if (left !== right) {
      if (left === null) return 1; // 日付なしは後ろ
      if (right === null) return -1;
      return left < right ? -1 : 1;
    }

    // 同着 / 日付なし同士は表示名で安定させる (実行ごとに順序が変わらないように)。
    return byName();
  };
}

/** 開催を状態別のグループへまとめる。空のグループは含まない。 */
export function groupOccurrencesByStatus(items: OccurrenceListItem[]): OccurrenceGroup[] {
  return GROUP_ORDER.map((key) => {
    const { label, within } = GROUP_DEFINITIONS[key];
    return {
      key,
      label,
      items: items.filter((item) => item.status === key).sort(compareWithin(within)),
    };
  }).filter((group) => group.items.length > 0);
}
