import { z } from 'zod';

/**
 * Schema-SDD 真実源: AI Provider 戻り値（Strategy パターンの契約）
 *
 * Truth basis: apps/ai-writer/lib/ai/providers/ai-provider.interface.ts SendMessageResult
 * 注: 既存 TypeScript interface とフィールド一致。将来は interface を本 schema 由来の z.infer に置換可能。
 */
// 注: totalTokens === promptTokens + completionTokens の算術不変条件は強制しない。
// Anthropic 等の prompt caching では cache_read / cache_creation が別カテゴリで
// カウントされ、totalTokens は input + output + cache_creation + cache_read の
// 合算となるため、単純加算が成立しない正当なケースが存在する (Provider 仕様依存)。
export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** Tokens served from a prior prompt-cache write (Anthropic cache_read_input_tokens). */
  cachedTokens: z.number().int().nonnegative().optional(),
  /** Tokens written to the prompt cache on this call (Anthropic cache_creation_input_tokens, 5m TTL). */
  cacheCreationTokens: z.number().int().nonnegative().optional(),
});

export const SendMessageResultSchema = z.object({
  // content は .min(1) を意図的に付けない。Provider が空文字を返すケース
  // (例: tool-only response、moderation-blocked) を契約として許容する。
  content: z.string(),
  model: z.string(),
  usage: TokenUsageSchema.optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;
