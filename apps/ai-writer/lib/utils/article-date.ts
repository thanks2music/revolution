/**
 * 記事の年と公開日を、開催の日付から決める (2026-11-25 BOSS 決定)
 *
 * 公式の URL から終わったイベントの記事を作ると、年 (記事の year・重複を見分けるキー・画像の置き場) が実行した年に、
 * 公開日が実行した日時になっていた。2023 年のイベントが新着のいちばん上に出て、同じ作品と店舗の本当の
 * その年の開催とキーがぶつかる恐れもあった。
 *
 * - 年: 開始日が分かれば、いつも開始日の年 (これからのイベントも。年末に告知された翌年のイベントは翌年)
 * - 公開日: 終了日が実行した日 (日本時間) より前のイベントだけ、開始日の日本時間 0 時。開催中・これから・終了日が
 *   分からないイベントは、実行した日時のまま
 */
import { startOfJstDay, toJstDateString } from './date';

/**
 * @param startDate 開始日 (`YYYY-MM-DD`)
 * @param fallback 開始日が分からないときの年
 */
export function articleYear(startDate: string | undefined, fallback: number): number {
  const year = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? Number(startDate.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : fallback;
}

/**
 * 記事を作った時点で終わっていたイベントか: 終了日 (`YYYY-MM-DD`) が実行した日 (日本時間) より前。終了日が分からなければ false。
 * 公開日・タイトル・この記事のポイント・まとめの見出しが、この判定で終わったイベントの書き方に切り替わる (2026-11-25 / 2026-11-27 BOSS 決定)
 */
export function isEventEnded(endDate: string | undefined, now: Date = new Date()): boolean {
  return !!endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate < toJstDateString(now);
}

/**
 * @param period 開始日と終了日 (`YYYY-MM-DD`、この記事のポイントと同じ値)
 * @param publishedAt 実行した日時 (ISO)。終わったイベントでなければ、これをそのまま返す
 * @param now 実行した日時
 */
export function articlePublishedDate(
  period: { start?: string; end?: string },
  publishedAt: string,
  now: Date = new Date(),
): string {
  const start = isEventEnded(period.end, now) && period.start ? startOfJstDay(period.start) : undefined;
  return start ? start.toISOString() : publishedAt;
}
