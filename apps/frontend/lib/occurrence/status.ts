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
