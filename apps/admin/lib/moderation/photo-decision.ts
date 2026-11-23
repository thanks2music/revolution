import { z } from 'zod';

import { REVIEW_REPORT_REASONS } from '@revolution/schemas/review-constants';

/** 写真ごとの判断 (Server Action の入力)。非公開にする写真には理由 (通報の 8 つ) が要る */
export const PhotoDecisionSchema = z.union([
  z.object({ id: z.number().int().positive(), hide: z.literal(false) }),
  z.object({
    id: z.number().int().positive(),
    hide: z.literal(true),
    reason: z.enum(REVIEW_REPORT_REASONS),
  }),
]);

/** 1 件の口コミの写真は 10 枚まで */
export const PhotoDecisionsSchema = z.array(PhotoDecisionSchema).max(10);
