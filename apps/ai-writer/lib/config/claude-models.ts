/**
 * Claude AI Model Definitions
 *
 * Purpose:
 *   - Centralized model name constants
 *   - Single source of truth for Claude model versions
 *   - Request settings every Claude call shares (thinking / effort / max_tokens)
 *
 * 応答の読み取りは `lib/ai/claude-response.ts` (Gemini の `config/gemini-models.ts` と
 * `ai/gemini-response.ts` の分け方と同じ)。
 *
 * @module lib/config/claude-models
 */

import type Anthropic from '@anthropic-ai/sdk';

/**
 * Claude Sonnet 5.5 Model
 *
 * Primary model for text generation (anthropic.provider.ts / claude-api.service.ts)
 * and Vision (claude-vision.service.ts).
 *
 * 2026-10-11 に `claude-sonnet-4-5-20250929` から移行した。Sonnet 4.5 は 2026-09-30 に
 * 非推奨となり、2026-11-30 に提供を終える。
 *
 * @see https://platform.claude.com/docs/en/about-claude/model-deprecations
 */
export const CLAUDE_MODEL_SONNET_5_5 = 'claude-sonnet-5-5' as const;

/**
 * Default model for all Claude API calls
 */
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODEL_SONNET_5_5;

/**
 * Model type definition for type safety
 */
export type ClaudeModel = typeof CLAUDE_MODEL_SONNET_5_5;

/**
 * Claude への全リクエストに付ける思考の設定。
 *
 * - Sonnet 5.5 は `thinking` を省くと adaptive + effort `high` (既定) で動く。抽出と文章生成には
 *   重いので、公式の移行ガイドが抽出・文章生成の出発点に挙げる `low` を明示する
 *   (2026-10-11 決定。Gemini の thinking LOW とも条件がそろう)
 * - `temperature` / `top_p` / `top_k` は既定値以外を送ると 400 になるため、Claude には送らない
 *
 * ⚠️ `output_config.effort` は Sonnet 4.5 以前では 400 になる。モデルを上書きするときは
 *    Sonnet 4.6 以降を使うこと。
 */
export const CLAUDE_THINKING_SETTINGS = {
  thinking: { type: 'adaptive' },
  output_config: { effort: 'low' },
} as const satisfies Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'>;

/**
 * `max_tokens` の下限。思考のトークンも `max_tokens` に含まれる (返答の文字に出なくても
 * 数えられる) ため、返答だけを見込んだ小さい上限 (slug の 100 など) では途中で切れる。
 *
 * 上限は設けない。ストリームなしで 21,334 以上を渡すと SDK が送る前に例外にするが
 * (`Streaming is required ...`)、黙って切り詰めるよりそのほうが気づける。今の呼び出しの
 * 返答の上限は最大でも 8,000 (本文の生成) で、そこには届かない。
 */
export const CLAUDE_MIN_MAX_TOKENS = 16_000;

/**
 * 返答に必要な上限から、思考の分も含めた `max_tokens` を決める。
 *
 * @param replyMaxTokens - 返答だけに必要なトークン数
 * @returns 下限 (`CLAUDE_MIN_MAX_TOKENS`) を下回らない `max_tokens`
 */
export function claudeMaxTokens(replyMaxTokens: number): number {
  return Math.max(replyMaxTokens, CLAUDE_MIN_MAX_TOKENS);
}
