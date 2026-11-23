import type { DocumentData } from 'firebase/firestore';

import type { Snapshot } from '@/types/snapshot';
import type { Target } from '@/types/target';

/**
 * Firestore のドキュメントを画面の型へ直す。
 *
 * 読む時は zod で検証しない。1 件の壊れたドキュメントで一覧ごと落ちるより、欠けた値を既定値か null に
 * 倒して全件を見せる方がよいため (書く時はフォームの zod で検証する)。
 */

/** cron が無い・空の時の既定。Functions (`functions/src/due.ts` の DEFAULT_CRON) と同じ */
export const DEFAULT_CRON = '0 * * * *';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * ms の epoch に直す。数値はそのまま、`toMillis()` を持つもの (Firestore の Timestamp) は変換する。
 * Timestamp を受けるのは書き込みの誤りへの保険で、書く側は必ず数値 (`Date.now()`) を使う。
 */
function asEpochMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof (value as { toMillis: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis: () => unknown }).toMillis();
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  }

  return null;
}

export function toTarget(id: string, data: DocumentData): Target {
  return {
    id,
    url: asString(data.url),
    selector: asString(data.selector),
    title: asString(data.title),
    // 空も既定に倒す。Functions も `target.cron || DEFAULT_CRON` で同じ既定を使うので、表示と動きがそろう
    cron: asString(data.cron) || DEFAULT_CRON,
    checkedAt: asEpochMillis(data.checkedAt),
    createdAt: asEpochMillis(data.createdAt),
    createdBy: asStringOrNull(data.createdBy),
    updatedAt: asEpochMillis(data.updatedAt),
    updatedBy: asStringOrNull(data.updatedBy),
  };
}

export function toSnapshot(id: string, data: DocumentData): Snapshot {
  return {
    id,
    content: asString(data.content),
    // time が壊れていたら 0 (epoch) で続ける。例外にすると履歴の画面ごと落ちる
    time: asEpochMillis(data.time) ?? 0,
  };
}
