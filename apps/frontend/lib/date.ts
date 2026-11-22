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

/** 日付 (YYYY-MM-DD) を「2026.07.03」の形にする (サイトの日付の表記) */
export function toDotDate(ymd: string): string {
  return ymd.replaceAll('-', '.');
}

/** 日時 (ISO) を日本時間の日付にして「2026.07.03」の形にする */
export function formatJstDotDate(iso: string): string {
  // en-CA は YYYY-MM-DD で返す (日本時間の日付を取り出すため)
  return toDotDate(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }));
}
