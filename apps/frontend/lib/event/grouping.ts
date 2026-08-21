import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

import type { Occurrence } from '@/lib/occurrence/queries';
import { OCCURRENCE_STATUS_LABELS } from '@/lib/occurrence/status';

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

/** 表示上のまとまり。`occurrence_view` の 5 状態と 1:1 なので別名は作らない。 */
type OccurrenceGroupKey = OccurrenceStatus;

export type OccurrenceGroup = {
  key: OccurrenceGroupKey;
  /** 見出し。状態バッジの文言とは別に、セクション名として読ませる。 */
  label: string;
  items: Occurrence[];
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
 * 表示順 + グループ内の並び。**配列の順序がそのまま画面の順序**。
 *
 * 見出しラベルは持たない — `OCCURRENCE_STATUS_LABELS` (`lib/occurrence/status.ts`)
 * が状態の語彙の SSoT。ここに残すのは grouping 固有の `within` だけ。
 *
 * ## 網羅性を型で守る
 *
 * 下の `MissingGroup` が「`OccurrenceStatus` のうち、この配列に無いもの」を計算し、
 * 空でなければコンパイルエラーになる。こうしないと **zod enum と
 * `toBadgeStatus` (Record が強制する) だけ直してここを忘れる**ことができ、
 * その状態の開催が「会場を選ぶ」から無言で落ちて件数表示と合計が食い違う
 * (PR #303 レビュー指摘)。
 *
 * ⚠️ 配列なので**同じ key を 2 回書ける**(同じグループが 2 度描画される)。
 *    Record + 別配列の二重構造にすればキー重複も防げるが、その形は
 *    「状態を 1 つ足すときの編集点が 2 箇所」という別のコストを生むため採らない。
 */
const GROUPS = [
  { key: 'ongoing', within: 'ends-asc' },
  { key: 'scheduled', within: 'starts-asc' },
  { key: 'unscheduled', within: 'name' },
  { key: 'ended', within: 'ends-asc' },
  { key: 'cancelled', within: 'name' },
] as const satisfies readonly { key: OccurrenceGroupKey; within: WithinOrder }[];

// 網羅漏れをコンパイル時に検出する。状態を足して GROUPS に書き忘れると型エラー。
type MissingGroup = Exclude<OccurrenceGroupKey, (typeof GROUPS)[number]['key']>;
const _assertAllStatusesGrouped: MissingGroup extends never ? true : never = true;
void _assertAllStatusesGrouped;

/**
 * グループ内の並び。`WithinOrder` の定義どおりに比較する。
 *
 * ⚠️ `starts_on` / `ends_on` はどちらも null を取り得るので、**null は末尾へ回す**。
 *    比較関数で null を 0 や Infinity に潰すと、常設 (`ends_on = null`) が
 *    先頭に来たりソートが不安定になったりする。
 */
function compareWithin(within: WithinOrder) {
  return (a: Occurrence, b: Occurrence): number => {
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
export function groupOccurrencesByStatus(items: Occurrence[]): OccurrenceGroup[] {
  return GROUPS.map(({ key, within }) => ({
    key,
    label: OCCURRENCE_STATUS_LABELS[key],
    items: items.filter((item) => item.status === key).sort(compareWithin(within)),
  })).filter((group) => group.items.length > 0);
}
