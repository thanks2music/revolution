/**
 * 日付を日本時間で表示する。サーバー (Vercel) は UTC で描くため、タイムゾーンを明示しないと
 * 日本時間 0〜9 時の日時が前日になる (2026-10-12T21:26Z が 10月12日 になっていた)
 */
export function formatJstDate(iso: string, month: 'long' | 'numeric' = 'long'): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month,
    day: 'numeric',
  });
}
