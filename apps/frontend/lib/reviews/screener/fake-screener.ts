import { REVIEW_SCREENING_REASONS, type ReviewScreeningReason } from '@revolution/schemas/review';

import type { ReviewScreeningDecision } from '@revolution/schemas/review-screening-response';

import type { ReviewScreener, ReviewScreeningResult } from './types';

/**
 * テストと E2E 用の偽の審査器。本文の目印で結果が決まる (本物の API を呼ばない)。
 *
 * | 本文に含む目印 | 結果 |
 * |---|---|
 * | `[reject:<理由>]` (理由は審査の 4 種。ほかの理由は失敗) | 差し戻し |
 * | `[unsure]` | 迷った (BOSS の確認待ち) |
 * | `[fail]` | 審査の失敗 |
 * | どれも無い | 通す |
 */
export const FAKE_SCREENER_MODEL = 'fake-screener';

export function createFakeScreener(): ReviewScreener {
  return {
    async screen({ body }): Promise<ReviewScreeningResult> {
      const text = body ?? '';
      if (text.includes('[fail]')) {
        return { ok: false, error: 'fake failure', model: FAKE_SCREENER_MODEL };
      }
      if (text.includes('[unsure]')) {
        return success('unsure', null, 'fake: unsure');
      }
      const reject = text.match(/\[reject:([a-z_]+)\]/);
      if (reject) {
        // 知らない理由は書き間違いなので、黙って公開せず失敗にする (E2E で気づけるように)
        if (!(REVIEW_SCREENING_REASONS as readonly string[]).includes(reject[1])) {
          return {
            ok: false,
            error: `fake: unknown reason ${reject[1]}`,
            model: FAKE_SCREENER_MODEL,
          };
        }
        return success('reject', reject[1] as ReviewScreeningReason, `fake: ${reject[1]}`);
      }
      return success('publish', null, 'fake: publish');
    },
  };
}

function success(
  decision: ReviewScreeningDecision,
  reasonCode: ReviewScreeningReason | null,
  reason: string
): ReviewScreeningResult {
  return { ok: true, decision, reasonCode, reason, model: FAKE_SCREENER_MODEL };
}
