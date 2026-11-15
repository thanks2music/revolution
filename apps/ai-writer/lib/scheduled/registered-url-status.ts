/**
 * How the admin UI shows what happened to a registered URL (pure, safe for the client).
 *
 * @module lib/scheduled/registered-url-status
 */
import type { RegisteredUrlAttemptView } from '@/lib/types/registered-url';
import { toJstDateString } from '@/lib/utils/date';

import type { AttemptStatus } from './retry-policy';

/** Still to be tried again: removing the registration gives it up (`unregisterUrl`) */
export function isAwaitingRetry(status: AttemptStatus | undefined): boolean {
  return status === 'waiting-details' || status === 'retrying-failure';
}

export type StatusTone = 'pending' | 'success' | 'neutral' | 'waiting' | 'error';

export interface RegisteredUrlStatusView {
  label: string;
  tone: StatusTone;
  /** Lines shown under the label */
  details: string[];
  prUrl?: string;
}

export function describeRegisteredUrlStatus(attempt: RegisteredUrlAttemptView | undefined): RegisteredUrlStatusView {
  if (!attempt) {
    return { label: '未試行', tone: 'pending', details: ['次の定期実行で試します'] };
  }

  const tried = `最後に試した日: ${toJstDateString(new Date(attempt.lastAttemptAt))} (${attempt.attemptCount} 回目)`;
  const reason = attempt.lastReason ? [`理由: ${attempt.lastReason}`] : [];

  switch (attempt.status) {
    case 'done':
      return attempt.lastOutcome === 'pr'
        ? { label: 'PR 作成', tone: 'success', details: [tried], prUrl: attempt.prUrl }
        : { label: 'スキップ', tone: 'neutral', details: [...reason, tried] };
    case 'waiting-details':
      return {
        label: '詳細未発表',
        tone: 'waiting',
        details: [
          ...(attempt.nextAttemptAt ? [`次に試す日: ${toJstDateString(new Date(attempt.nextAttemptAt))}`] : []),
          tried,
        ],
      };
    case 'retrying-failure':
      return { label: '失敗 (試し直し待ち)', tone: 'error', details: [...reason, '次の定期実行で試し直します', tried] };
    case 'given-up':
      return {
        label: '打ち切り',
        tone: 'error',
        details: [...(attempt.givenUpReason ? [attempt.givenUpReason] : []), ...reason, tried],
      };
  }
}
