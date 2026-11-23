/**
 * 監視対象の通知の仕方。Firestore の値と既定は `apps/web-checker/functions/src/targets.ts` の `NOTIFY_MODES` と
 * rules (`apps/ai-writer/firestore.rules`) にそろえる。
 */
export const NOTIFY_MODES = ['slack', 'ai-writer'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/** 値が無い監視対象 (この欄より前に作った物) と、新しく作る時の既定 */
export const DEFAULT_NOTIFY_MODE: NotifyMode = 'slack';

export const NOTIFY_MODE_LABELS: Record<NotifyMode, string> = {
  slack: 'Slack に通知するだけ',
  'ai-writer': 'AI ライターに渡して、Slack にも通知する',
};

export function isNotifyMode(value: unknown): value is NotifyMode {
  return typeof value === 'string' && (NOTIFY_MODES as readonly string[]).includes(value);
}
