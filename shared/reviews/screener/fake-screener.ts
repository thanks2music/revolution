import { REVIEW_SCREENING_REASONS, type ReviewScreeningReason } from '@revolution/schemas/review';

import type { ReviewScreeningDecision } from '@revolution/schemas/review-screening-response';

import type { ReviewPhotoScreening, ReviewScreener, ReviewScreeningResult } from './types';

/**
 * テストと E2E 用の偽の審査器。本文の目印で結果が決まる (本物の API を呼ばない)。
 *
 * | 本文に含む目印 | 結果 |
 * |---|---|
 * | `[reject:<理由>]` (理由は審査の 4 種。ほかの理由は失敗) | 差し戻し |
 * | `[unsure]` | 迷った (BOSS の確認待ち) |
 * | `[fail]` | 審査の失敗 |
 * | どれも無い | 通す |
 *
 * 写真 (one-more-time #164): 本文に `[hide-photo:<番号>:<理由>]` があればその写真を非公開に、
 * `[unsure-photo:<番号>]` があれば迷った (口コミは BOSS の確認待ち) にする。番号は 1 から。
 */
export const FAKE_SCREENER_MODEL = 'fake-screener';

export function createFakeScreener(): ReviewScreener {
  return {
    async screen({ body, photos }): Promise<ReviewScreeningResult> {
      const text = body ?? '';
      const photoResults = photos.map((_, i) => photoDecision(text, i + 1));
      if (text.includes('[fail]')) {
        return { ok: false, error: 'fake failure', model: FAKE_SCREENER_MODEL };
      }
      if (text.includes('[unsure]')) {
        return success('unsure', null, 'fake: unsure', photoResults);
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
        return success(
          'reject',
          reject[1] as ReviewScreeningReason,
          `fake: ${reject[1]}`,
          photoResults
        );
      }
      return success('publish', null, 'fake: publish', photoResults);
    },
  };
}

function photoDecision(text: string, index: number): ReviewPhotoScreening {
  if (text.includes(`[unsure-photo:${index}]`)) return { decision: 'unsure', reasonCode: null };
  const hide = text.match(new RegExp(`\\[hide-photo:${index}:([a-z_]+)\\]`));
  if (hide && (REVIEW_SCREENING_REASONS as readonly string[]).includes(hide[1])) {
    return { decision: 'hide', reasonCode: hide[1] as ReviewScreeningReason };
  }
  return { decision: 'ok', reasonCode: null };
}

function success(
  decision: ReviewScreeningDecision,
  reasonCode: ReviewScreeningReason | null,
  reason: string,
  photos: ReviewPhotoScreening[]
): ReviewScreeningResult {
  return { ok: true, decision, reasonCode, reason, model: FAKE_SCREENER_MODEL, photos };
}
