import {
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import { z } from 'zod';

import { ReviewScreeningResponseSchema } from '@revolution/schemas/review-screening-response';

import { renderUserPrompt, type ScreeningPrompt } from './prompt';
import { classifyError, withTransientRetry } from './retry';
import type {
  ReviewPhotoScreening,
  ReviewScreener,
  ReviewScreeningInput,
  ReviewScreeningResult,
} from './types';

/**
 * Gemini による口コミの審査器 (ADR-0001 と同じ provider)。
 *
 * - 構造化出力 (`responseMimeType` + `responseJsonSchema`) で判定を受け取り、zod で検証する
 * - 写真は本文の後ろに「写真 N」の見出しを付けて画像のまま渡す。応答の写真ごとの判定は、渡した数と
 *   番号が合わなければ形の崩れとして扱う (判定の無い写真を黙って公開しないため)
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
/** 判定は短い JSON なので小さく取る (写真 10 枚の判定が入っても足りる大きさ) */
const MAX_OUTPUT_TOKENS = 2_048;

const RESPONSE_JSON_SCHEMA = z.toJSONSchema(ReviewScreeningResponseSchema, { target: 'draft-7' });

const THINKING_LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

/** やり直しても結果が変わらない失敗 (打ち切り・ブロック・形の崩れ) */
class DeterministicScreeningError extends Error {}

export function createGeminiScreener(options: GeminiScreenerOptions): ReviewScreener {
  const model = options.model ?? options.prompt.model;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const thinkingLevel =
    options.prompt.thinking_level && THINKING_LEVELS[options.prompt.thinking_level];

  function request(input: ReviewScreeningInput): GenerateContentParameters {
    return {
      model,
      contents: [{ role: 'user', parts: contentParts(options.prompt, input) }],
      config: {
        systemInstruction: options.prompt.system,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // thinking の深さはプロンプトがモデルと対で決める (thinking のトークンも maxOutputTokens に数えられる)
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        // やり直しのたびに新しい時間切れにする
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    };
  }

  return {
    async screen(input): Promise<ReviewScreeningResult> {
      try {
        const response = await withTransientRetry(
          () => options.models.generateContent(request(input)),
          options.retry
        );
        const parsed = parseResponse(response);
        const photos = matchPhotos(parsed.photos, input.photos.length);
        return {
          ok: true,
          decision: parsed.decision,
          reasonCode: parsed.reason_code,
          // 説明は管理画面で読む物。長すぎる応答も判定は生かし、ここで切る (絵文字などを途中で割らないよう文字単位で)
          reason: Array.from(parsed.reason).slice(0, REASON_MAX_CHARS).join(''),
          model,
          photos,
        };
      } catch (error) {
        return { ok: false, error: describeError(error), model };
      }
    },
  };
}

/** 本文 (プロンプトに埋め込んだ物) の後ろに、「写真 N」の見出しと画像を並べる */
export function contentParts(prompt: ScreeningPrompt, input: ReviewScreeningInput) {
  return [
    { text: renderUserPrompt(prompt, input.body) },
    ...input.photos.flatMap((photo, i) => [
      { text: `写真 ${i + 1}` },
      {
        inlineData: { mimeType: photo.mimeType, data: Buffer.from(photo.data).toString('base64') },
      },
    ]),
  ];
}

/** 応答の写真ごとの判定を、渡した写真の順に並べる。数や番号が合わなければ形の崩れ */
function matchPhotos(
  photos: {
    index: number;
    decision: ReviewPhotoScreening['decision'];
    reason_code: ReviewPhotoScreening['reasonCode'];
  }[],
  count: number
): ReviewPhotoScreening[] {
  const byIndex = new Map(photos.map(photo => [photo.index, photo]));
  if (photos.length !== count || byIndex.size !== count) {
    throw new DeterministicScreeningError(
      `photo judgements do not match (${photos.length}/${count})`
    );
  }
  return Array.from({ length: count }, (_, i) => {
    const photo = byIndex.get(i + 1);
    if (!photo) throw new DeterministicScreeningError(`photo ${i + 1} has no judgement`);
    return { decision: photo.decision, reasonCode: photo.reason_code };
  });
}

function parseResponse(response: GenerateContentResponse) {
  const finishReason = response.candidates?.[0]?.finishReason;
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
    throw new DeterministicScreeningError(
      `response shape is invalid (${result.error.issues[0]?.message})`
    );
  }
  return result.data;
}

/** 失敗の内容を短い文にする。SDK のメッセージには本文が含まれうるので、種類と HTTP のステータスだけにする */
function describeError(error: unknown): string {
  if (error instanceof DeterministicScreeningError) return error.message;
  const classified = classifyError(error);
  switch (classified.kind) {
    case 'http':
      return `api error (HTTP ${classified.status})`;
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'network error';
    case 'other':
      return classified.name ? `error (${classified.name})` : 'unknown error';
  }
}
