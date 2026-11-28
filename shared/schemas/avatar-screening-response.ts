import { z } from 'zod';

/**
 * プロフィール画像の AI 審査の応答 (one-more-time #171)。Gemini の構造化出力にこの形を渡し、受け取った物を
 * この形で確かめる。落とすのは性的・暴力的な画像だけ (ADR-0005 の「プロフィール画像は軽い審査にする」)
 */
export const AvatarScreeningResponseSchema = z
  .object({
    decision: z.enum(['ok', 'reject']),
    reason_code: z.enum(['sexual_or_violent']).nullable(),
    reason: z.string(),
  })
  .refine(value => (value.decision === 'reject') === (value.reason_code !== null), {
    message: 'reason_code must be set only when decision is reject',
  });
