/**
 * 最近見た開催 (7-0 の「最近見た開催」、one-more-time #166)。ブラウザの localStorage に、新しい順で ID を残す。
 * 読めない・書けない時 (プライベートブラウズなど) は、何もしない (画面の表示を止めない)。
 */
export const RECENT_OCCURRENCES_KEY = 'recent-occurrences';
export const RECENT_OCCURRENCES_LIMIT = 10;

/** 新しく見た開催を先頭に足す (同じ開催は前の位置から外す) */
export function pushRecent(ids: number[], occurrenceId: number): number[] {
  return [occurrenceId, ...ids.filter(id => id !== occurrenceId)].slice(
    0,
    RECENT_OCCURRENCES_LIMIT
  );
}

/** 残した文字列を ID の一覧にする (壊れた値は空として扱う) */
export function parseRecent(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is number => Number.isInteger(id) && id > 0)
          .slice(0, RECENT_OCCURRENCES_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function readRecent(): number[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_OCCURRENCES_KEY));
  } catch {
    return [];
  }
}

export function recordRecent(occurrenceId: number): void {
  try {
    window.localStorage.setItem(
      RECENT_OCCURRENCES_KEY,
      JSON.stringify(pushRecent(readRecent(), occurrenceId))
    );
  } catch {
    // 書けなくても画面は続ける
  }
}
