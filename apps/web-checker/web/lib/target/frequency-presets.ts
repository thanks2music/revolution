import { DEFAULT_CRON } from '@/lib/firestore/mappers';

/**
 * 頻度のプリセット。保存するのは cron の文字列で、プリセットは入力のための物。
 *
 * 見回りは毎時 05 分に 1 回なので、cron をそれより細かくしても 1 時間に 1 回になる。プリセットを主にして、
 * 効かない指定をさせないようにする。cron は Asia/Tokyo で読む (「朝 9 時」は日本時間の 9 時)。
 * @see apps/web-checker/functions/src/due.ts
 */
export interface FrequencyPreset {
  /** 画面に出す名前 */
  label: string;
  /** Firestore に保存する cron */
  cron: string;
  /** 実際に見に行く時刻の補足 (毎時 05 分の見回りに合わせた物) */
  note: string;
}

export const FREQUENCY_PRESETS: readonly FrequencyPreset[] = [
  { label: '1 時間に 1 回', cron: DEFAULT_CRON, note: '毎時 05 分ごろ' },
  { label: '3 時間に 1 回', cron: '0 */3 * * *', note: '0/3/6/9/12/15/18/21 時の 05 分ごろ' },
  { label: '6 時間に 1 回', cron: '0 */6 * * *', note: '0/6/12/18 時の 05 分ごろ' },
  { label: '1 日 1 回 (朝 9 時)', cron: '0 9 * * *', note: '毎日 9:05 ごろ' },
  { label: '1 日 1 回 (夜 21 時)', cron: '0 21 * * *', note: '毎日 21:05 ごろ' },
  { label: '平日だけ 1 日 1 回 (朝 9 時)', cron: '0 9 * * 1-5', note: '月〜金 9:05 ごろ' },
  { label: '週 1 回 (月曜 9 時)', cron: '0 9 * * 1', note: '毎週月曜 9:05 ごろ' },
];

/**
 * cron に合うプリセットを返す。無ければ undefined (= 自由入力)。
 *
 * 合わない cron をプリセットに丸めると、編集を開いて保存しただけで頻度が変わってしまうので、そのまま扱う。
 */
export function matchPreset(cron: string): FrequencyPreset | undefined {
  const normalized = cron.trim().replace(/\s+/g, ' ');
  return FREQUENCY_PRESETS.find(preset => preset.cron === normalized);
}
