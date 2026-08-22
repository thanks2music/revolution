import type { EventStatus } from '@/components/atoms/badge/StatusBadge';
import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

/**
 * `occurrence_view.status` (5 値) → 表示用バッジ状態 (`EventStatus`) の写像。
 *
 * ## なぜ写像が要るのか
 *
 * DB 側の語彙 (`scheduled` / `ongoing` / …) は**日付から導出した事実**で、
 * バッジ側の語彙 (`coming-soon` / `now` / …) は**記事カードから続く表示上の呼び名**。
 * 両者は 1:1 で対応するが同じ文字列ではないので、境界で明示的に写す。
 *
 * ## view に値が増えたら型エラーになる
 *
 * `Record<OccurrenceStatus, EventStatus>` はキーの欠落をコンパイルエラーにする。
 * `occurrence_view` の CASE 式に 6 つ目の状態が増えて
 * `OCCURRENCE_STATUS_VALUES` に追加されると、**ここが型エラーになる**。
 * (`lib/event/grouping.ts` も同じ Record 方式で網羅性を守っている)
 *
 * これは実際に踏んだ事故への対策である。`0016` で `unscheduled` を追加した際、
 * zod の enum 更新が漏れて「view が返す値を enum が持たず parse が reject する」
 * 状態になった (claude[bot] PR #291 指摘)。同じ漏れが表示側でも起きると、
 * 今度は**バッジが undefined のスタイルで描画される**。黙って壊れる経路を塞ぐ。
 */
const BADGE_STATUS: Record<OccurrenceStatus, EventStatus> = {
  scheduled: 'coming-soon',
  ongoing: 'now',
  ended: 'ended',
  unscheduled: 'unscheduled',
  // 中止バッジは出すが、**中止ページとしての表現 (中止理由の注記など) は未実装**。
  // ページ全体のデザインが未作成のため (C-3、2026-08-14 BOSS 判断で後回し)。
  cancelled: 'cancelled',
};

export function toBadgeStatus(status: OccurrenceStatus): EventStatus {
  return BADGE_STATUS[status];
}

/**
 * 開催状態の**表示順**。「今行けるものを先に」出す。
 *
 * 終了・中止を上に置くと「もう行けない選択肢」を先に読ませることになる。
 * 日程未発表を終了より前に置いているのは、**まだ行ける可能性がある**ため
 * (`unscheduled` は欠損ではなく「主催者が日程を発表していない」正規の状態、
 * 2026-08-09 確定)。
 *
 * ## なぜここに置くか
 *
 * この順序と下の見出しラベルは、元々 `lib/event/grouping.ts` と
 * `lib/venue/grouping.ts` の `GROUPS` 配列に**同じ値で 2 重定義**されていた。
 * `/events` 一覧の状態別サマリ (v6 #14) が 3 例目になるため、rule-of-3 を満たした
 * 時点で状態の語彙を持つ本モジュール (`toBadgeStatus` の隣) へ引き上げた。
 *
 * ⚠️ 各 grouping モジュールが持つ `within` (グループ内の並び規則) は
 *    grouping 固有なので**引き上げない**。ここに集めるのは「状態の語彙」だけ。
 *
 * `satisfies` で `OccurrenceStatus` の網羅を強制する。view に 6 つ目の状態が
 * 増えたら型エラーになる (`BADGE_STATUS` の Record と同じ守り方)。
 */
export const OCCURRENCE_STATUS_ORDER = [
  'ongoing',
  'scheduled',
  'unscheduled',
  'ended',
  'cancelled',
] as const satisfies readonly OccurrenceStatus[];

// 網羅漏れをコンパイル時に検出する。状態を足してここを忘れると型エラー。
type MissingStatus = Exclude<OccurrenceStatus, (typeof OCCURRENCE_STATUS_ORDER)[number]>;
const _assertAllStatusesOrdered: MissingStatus extends never ? true : never = true;
void _assertAllStatusesOrdered;

/**
 * 見出し・サマリで読ませる状態名。
 *
 * ⚠️ **`StatusBadge` の文言 (`labelByStatus`) とは別物**。あちらはカード上の
 * バッジとして短く出す呼び名 (`Coming Soon` 等)、こちらはセクション見出しや
 * 件数サマリで読ませる日本語。同じ値に揃えたくなるが、用途が違うので統合しない。
 */
export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  ongoing: '開催中',
  scheduled: '開催予定',
  unscheduled: '日程未発表',
  ended: '終了',
  cancelled: '中止',
};

/** 状態別サマリの 1 項目 (`/events` 一覧カードの「開催中 1 / 終了 2」)。 */
export type StatusCount = {
  status: OccurrenceStatus;
  label: string;
  count: number;
};

/**
 * 状態別の件数を**表示順に並べ、0 件の状態を落とす** (Layer 1、純粋関数)。
 *
 * 0 件を落とすのは grouping が「空のグループは返さない」のと同じ規律 —
 * 「終了 0」のような無情報を並べない。すべて 0 なら空配列。
 */
export function summarizeStatusCounts(
  counts: Partial<Record<OccurrenceStatus, number>>,
): StatusCount[] {
  return OCCURRENCE_STATUS_ORDER.map((status) => ({
    status,
    label: OCCURRENCE_STATUS_LABELS[status],
    count: counts[status] ?? 0,
  })).filter((entry) => entry.count > 0);
}

/**
 * JST の「今日」を `YYYY-MM-DD` で返す。
 *
 * ⚠️ **`occurrence_view` は JST 固定で状態を導出している** (`0016` の
 * `now() at time zone 'Asia/Tokyo'`)。表示側がサーバのローカル時刻や UTC で
 * 残日数を数えると、DB が `ongoing` と言っているのに残日数が負になるような
 * **状態と残日数の食い違い**が出る。基準を JST に揃えるのが本関数の役目。
 *
 * Vercel の実行環境は UTC なので、ローカル (JST) では再現しない形でずれる。
 */
export function todayInJst(now: Date = new Date()): string {
  // en-CA ロケールは YYYY-MM-DD を返す (ISO と同形)。手で時差を足す実装は
  // 月跨ぎ・年跨ぎを自前で処理することになるので使わない。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * `YYYY-MM-DD` 同士の日数差 (to - from)。同日なら 0、未来なら正。
 *
 * 両方を UTC 正午として解釈して引き算する。UTC 深夜 0 時ではなく正午を使うのは、
 * 夏時間を持つタイムゾーンで日付が 1 日ずれる古典的な罠を避けるため
 * (JST に夏時間は無いが、この関数が別用途へ流用されたときに壊れない形にしておく)。
 */
export function diffInDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T12:00:00Z`);
  const toMs = Date.parse(`${to}T12:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}
