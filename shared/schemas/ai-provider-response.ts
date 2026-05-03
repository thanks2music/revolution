import { z } from 'zod';

/**
 * Schema-SDD 真実源: AI Provider 戻り値（Strategy パターンの契約）
 *
 * Truth basis: apps/ai-writer/lib/ai/providers/ai-provider.interface.ts SendMessageResult
 * 注: 既存 TypeScript interface とフィールド一致。将来は interface を本 schema 由来の z.infer に置換可能。
 */
export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const SendMessageResultSchema = z.object({
  content: z.string(),
  model: z.string(),
  usage: TokenUsageSchema.optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;
