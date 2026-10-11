/**
 * Claude AI Model Definitions
 *
 * Purpose:
 *   - Centralized model name constants
 *   - Single source of truth for Claude model versions
 *   - Request settings every Claude call shares (thinking / effort / max_tokens)
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
 */
export const CLAUDE_MIN_MAX_TOKENS = 16_000;

/**
 * ストリームなしで送れる `max_tokens` の上限。SDK は「3,600,000 ms × max_tokens / 128,000」が
 * 10 分を超えると、送る前に例外にする (`Streaming is required ...`)。21,334 からが該当する。
 */
export const CLAUDE_MAX_NONSTREAMING_TOKENS = 21_333;

/**
 * 返答に必要な上限から、思考の分も含めた `max_tokens` を決める。
 *
 * 呼び出し元の返答の上限は最大でも 8,000 (本文の生成) なので、下限の 16,000 との差が思考の余地になる。
 *
 * @param replyMaxTokens - 返答だけに必要なトークン数
 * @returns 下限 (`CLAUDE_MIN_MAX_TOKENS`) と上限 (`CLAUDE_MAX_NONSTREAMING_TOKENS`) の間に収めた値
 */
export function claudeMaxTokens(replyMaxTokens: number): number {
  return Math.min(Math.max(replyMaxTokens, CLAUDE_MIN_MAX_TOKENS), CLAUDE_MAX_NONSTREAMING_TOKENS);
}

/**
 * 応答が最後まで書かれなかったことを表す (拒否、または `max_tokens` での切り詰め)。
 * どちらも同じ入力で再送しても結果は変わらないため、呼び出し側はリトライしない。
 */
export class ClaudeIncompleteResponseError extends Error {
  constructor(
    readonly stopReason: 'refusal' | 'max_tokens',
    message: string
  ) {
    super(message);
    this.name = 'ClaudeIncompleteResponseError';
  }
}

/**
 * 応答が最後まで書かれたことを確かめる。
 *
 * - `refusal`: Sonnet 5.5 の安全性の分類器 (cyber / bio / frontier_llm / reasoning_extraction /
 *   general_harms) が断った。HTTP 200 で返るため、`stop_reason` を見ないと気づけない
 * - `max_tokens`: 思考と返答で上限に達し、途中で切れた (Gemini の MAX_TOKENS と同じ扱い)
 *
 * @param message - Messages API の応答
 * @param label - エラーメッセージに付ける呼び出し元の名前
 * @throws {ClaudeIncompleteResponseError} `stop_reason` が `refusal` か `max_tokens` のとき
 */
export function assertClaudeResponseComplete(
  message: Pick<Anthropic.Message, 'stop_reason' | 'stop_details'>,
  label: string
): void {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ?? 'unknown';
    throw new ClaudeIncompleteResponseError(
      'refusal',
      `[${label}] Claude refused the request (category: ${category})`
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeIncompleteResponseError(
      'max_tokens',
      `[${label}] Claude response was truncated (stop_reason=max_tokens)`
    );
  }
}

/**
 * 応答の本文 (text のブロック) を取り出す。
 *
 * adaptive thinking では、応答の先頭に `thinking` のブロックが来ることがある。
 * `content[0]` を text と決めつけず、`type` で選ぶ。複数の text ブロックはつなげる。
 *
 * @param message - Messages API の応答
 * @returns text のブロックをつないだ文字列。text のブロックが無ければ null
 */
export function getClaudeResponseText(message: Pick<Anthropic.Message, 'content'>): string | null {
  const texts = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  return texts.length > 0 ? texts.join('') : null;
}
