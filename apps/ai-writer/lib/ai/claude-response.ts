/**
 * @fileoverview Claude (Messages API) の応答の読み取り (Layer 1)
 *
 * `gemini-response.ts` の `readGeminiText` と同じ役割。異常終了した応答を正常な結果として
 * 返さないことを、呼び出し側ごとの手書きではなくここで保証する。
 */

import type Anthropic from '@anthropic-ai/sdk';

/**
 * 応答が最後まで書かれなかったことを表す (拒否、または `max_tokens` での切り詰め)。
 *
 * どちらも同じ入力で再送しても結果は変わらないため、呼び出し側はリトライしない。
 * 🔴 catch で汎用の `Error` に包み直さないこと (`instanceof` でリトライを止めている箇所がある)。
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
 * 応答の本文 (text のブロック) を取り出す。**最後まで書かれなかった応答は失敗にする**
 *
 * - `refusal`: Sonnet 5.5 の安全性の分類器 (cyber / bio / frontier_llm / reasoning_extraction /
 *   general_harms) が断った。HTTP 200 で返るため、`stop_reason` を見ないと気づけない
 * - `max_tokens`: 思考と返答で上限に達し、途中で切れた (Gemini の MAX_TOKENS と同じ扱い)
 * - adaptive thinking では先頭に `thinking` のブロックが来るため、`content[0]` ではなく `type` で
 *   選ぶ。複数の text ブロックはつなげる
 *
 * @param message - Messages API の応答
 * @param label - エラーメッセージに付ける呼び出し元の名前
 * @returns text のブロックをつないだ文字列
 * @throws {ClaudeIncompleteResponseError} `stop_reason` が `refusal` か `max_tokens` のとき
 * @throws {Error} text のブロックが 1 つも無いとき
 */
export function readClaudeText(
  message: Pick<Anthropic.Message, 'content' | 'stop_reason' | 'stop_details'>,
  label: string
): string {
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

  const texts = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  if (texts.length === 0) {
    throw new Error(`[${label}] No text content in Claude response`);
  }
  return texts.join('');
}
