import { z } from 'zod';

import { REVIEW_SCREENING_REASONS } from './review';

/**
 * 口コミの AI 審査の応答 (Gemini の構造化出力)。
 *
 * - `decision`: publish (通す) / reject (差し戻す) / unsure (迷った → BOSS の確認待ち)
 * - `reason_code`: reject の時の理由 (審査の 4 種)。それ以外は null
 * - `reason`: 判断の短い説明。管理画面だけで見る (投稿者には見せない)
 *
 * Gemini には `z.toJSONSchema` でこの形を渡し (`responseJsonSchema`)、受け取った応答もこの形で検証する。
 * reject なのに理由のコードが無い応答は、形が崩れているとみなす。
 */
export const ReviewScreeningResponseSchema = z
  .object({
    decision: z.enum(['publish', 'reject', 'unsure']),
    reason_code: z.enum(REVIEW_SCREENING_REASONS).nullable(),
    reason: z.string().max(500),
  })
  .refine((value) => value.decision !== 'reject' || value.reason_code !== null, {
    message: 'reject requires reason_code',
    path: ['reason_code'],
  });

export type ReviewScreeningResponse = z.infer<typeof ReviewScreeningResponseSchema>;
