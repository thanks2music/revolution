import type { OccurrenceStatus } from '@revolution/schemas/occurrence';

/**
 * 開催の期間表示 (Layer 1、純粋関数)。
 *
 * 開催詳細ページと企画ページの両方で使うため、`page.tsx` から切り出している。
 * 表記が画面ごとにずれると、同じ開催が別の書き方で 2 度出てくることになる。
 */

/**
 * `YYYY-MM-DD` の期間を日本語表記へ。
 *
 * ⚠️ **null を空欄にしない**。`occurrences` の日付は 2 種類の null を持ち、
 * どちらも欠損ではなく正規の状態なので、それぞれ明示的に言葉にする:
 *
 * - `starts_on = null` → 日程未発表 (★2026-08-09、`unscheduled` 状態)
 * - `ends_on = null` → 終了日未定 / 常設 (★決定⑤)
 *
 * 空欄にすると「データが抜けている」ように見え、実際は「まだ決まっていない」
 * という事実が伝わらない。
 */
export function formatPeriod(startsOn: string | null, endsOn: string | null): string {
  if (!startsOn) return '日程未発表';
  const start = startsOn.replace(/-/g, '.');
  if (!endsOn) return `${start} 〜 (終了日未定)`;
  return `${start} 〜 ${endsOn.replace(/-/g, '.')}`;
}

/**
 * 期間表示に添える時制の言葉 (Claude Design v6 #16)。
 *
 * 同じ `2026.02.10 〜 05.06` が「これから」なのか「もう終わった」のか
 * 「中止になった予定」なのかは、**状態バッジを見ないと分からない**。
 * カード内で日付の隣に置くことで、バッジと日付を往復せずに読めるようにする。
 *
 * ⚠️ **日付が無いときは付けない。** `formatPeriod` が既に「日程未発表」という
 *    完成した文を返しているため、後ろに何か足すと二重表現になる。
 *
 * 🔴 **判定を `status` だけで行わないこと。** `occurrence_view` の CASE は
 *    `cancelled` を `unscheduled` より**先**に評価する
 *    (`0016_..._occurrences_starts_on_nullable.sql`)。つまり
 *    **`cancelled_at` があって `starts_on` が null の開催は `'cancelled'`** として
 *    返り、`status === 'unscheduled'` では捕まえられない。
 *    `status` だけを見ると「日程未発表 の予定」という二重表現が出る
 *    (2026-08-22 `/code-review` 指摘、view 定義で再現性を確認)。
 *    **`startsOn` の有無で判定する**のが正しい。
 */
export function formatPeriodTense(
  status: OccurrenceStatus,
  startsOn: string | null,
): string {
  if (startsOn === null) return '';
  return PERIOD_TENSE[status];
}

const PERIOD_TENSE: Record<OccurrenceStatus, string> = {
  ongoing: '',
  scheduled: '',
  unscheduled: '',
  ended: ' に開催',
  cancelled: ' の予定',
};
