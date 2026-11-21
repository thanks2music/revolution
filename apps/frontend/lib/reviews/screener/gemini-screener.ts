import { ThinkingLevel, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';

import { ReviewScreeningResponseSchema } from '@revolution/schemas/review-screening-response';

import type { ScreeningPrompt } from './prompt';
import { renderUserPrompt } from './prompt';
import { withTransientRetry } from './retry';
import type { ReviewScreener, ReviewScreeningResult } from './types';

/**
 * Gemini による口コミの審査器 (ADR-0001 と同じ provider)。
 *
 * - 構造化出力 (`responseMimeType` + `responseJsonSchema`) で判定を受け取り、zod で検証する
 * - 429・5xx・タイムアウトは 2 回までやり直す (`retry.ts`)。形の崩れた応答・ブロック・打ち切りはやり直さない
 * - 失敗は例外にせず `{ ok: false }` で返す。失敗の内容に本文と鍵は含めない
 */

/** 呼び出す口だけを持つ (テストで差し替えるため。実体は `new GoogleGenAI(...).models`) */
export interface GeminiModels {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

export interface GeminiScreenerOptions {
  models: GeminiModels;
  prompt: ScreeningPrompt;
  /** 使うモデル (env で上書きした物。無ければプロンプトの既定) */
  model?: string;
  /** 1 回の呼び出しの上限 (ミリ秒) */
  timeoutMs?: number;
  retry?: Parameters<typeof withTransientRetry>[1];
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** 管理画面に残す判断の説明の上限 (字) */
const REASON_MAX_CHARS = 500;
/** 判定は短い JSON なので小さく取る */
const MAX_OUTPUT_TOKENS = 1_024;

const RESPONSE_JSON_SCHEMA = z.toJSONSchema(ReviewScreeningResponseSchema, { target: 'draft-7' });

/** やり直しても結果が変わらない失敗 (打ち切り・ブロック・形の崩れ) */
class DeterministicScreeningError extends Error {}

export function createGeminiScreener(options: GeminiScreenerOptions): ReviewScreener {
  const model = options.model ?? options.prompt.model;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function request(body: string | null): GenerateContentParameters {
    return {
      model,
      contents: renderUserPrompt(options.prompt, body),
      config: {
        systemInstruction: options.prompt.system,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // 判定は短い JSON なので thinking は最小にする (thinking のトークンも maxOutputTokens に数えられる)。
        // thinkingLevel は Gemini 3 系の指定で、ほかの系統には送らない (受け付けずに全件が失敗しうるため)
        ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        // やり直しのたびに新しい時間切れにする
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    };
  }

  return {
    async screen({ body }): Promise<ReviewScreeningResult> {
      try {
        const response = await withTransientRetry(
          () => options.models.generateContent(request(body)),
          options.retry,
        );
        const parsed = parseResponse(response);
        return {
          ok: true,
          decision: parsed.decision,
          reasonCode: parsed.reason_code,
          // 説明は管理画面で読む物。長すぎる応答も判定は生かし、ここで切る
          reason: parsed.reason.slice(0, REASON_MAX_CHARS),
          model,
        };
      } catch (error) {
        return { ok: false, error: describeError(error), model };
      }
    },
  };
}

function parseResponse(response: GenerateContentResponse) {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    throw new DeterministicScreeningError('response truncated (MAX_TOKENS)');
  }
  if (finishReason && finishReason !== 'STOP') {
    throw new DeterministicScreeningError(`response stopped (${finishReason})`);
  }
  const text = response.text;
  if (!text) throw new DeterministicScreeningError('empty response');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DeterministicScreeningError('response is not JSON');
  }
  const result = ReviewScreeningResponseSchema.safeParse(json);
  if (!result.success) {
    throw new DeterministicScreeningError(`response shape is invalid (${result.error.issues[0]?.message})`);
  }
  return result.data;
}

/** 失敗の内容を短い文にする。SDK のメッセージには本文が含まれうるので、種類と HTTP のステータスだけにする */
function describeError(error: unknown): string {
  if (error instanceof DeterministicScreeningError) return error.message;
  if (typeof error === 'object' && error !== null) {
    const { status, name } = error as { status?: unknown; name?: unknown };
    if (typeof status === 'number') return `api error (HTTP ${status})`;
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    if (typeof name === 'string') return `error (${name})`;
  }
  return 'unknown error';
}
