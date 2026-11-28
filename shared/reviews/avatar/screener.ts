import 'server-only';

import { createHash } from 'node:crypto';

import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { z } from 'zod';

import { AvatarScreeningResponseSchema } from '@revolution/schemas/avatar-screening-response';
import { presentEnvValue } from '@revolution/slack/env';

import { allowsFakeBackends } from '../fake-backends';
import {
  describeError,
  parseStructuredResponse,
  THINKING_LEVELS,
  type GeminiModels,
} from '../screener/gemini-screener';
import { DEFAULT_TEMPLATES_DIR } from '../screener/prompt';
import { withTransientRetry } from '../screener/retry';

import { loadAvatarScreeningPrompt, type AvatarScreeningPrompt } from './prompt';

/**
 * プロフィール画像の審査器 (one-more-time #171、ADR-0005 の「プロフィール画像は軽い審査にする」)。
 *
 * 口コミの審査器 (`../screener`) と同じ作り: Gemini の構造化出力・429/5xx/タイムアウトは 2 回までやり直す・
 * 例外を投げず `{ ok: false }` で返す。違うのは、入力が画像 1 枚だけで、落とすのが性的・暴力的な物だけなこと。
 * プロンプトは revolution-templates の `reviews/avatar-screening.yaml` (口コミの審査と同じ取り込み)。
 * 失敗した時、呼ぶ側は「落ちた」(理由は「確認できなかった」) にする (BOSS の待ち行列には入れない)
 */
export interface AvatarScreener {
  screen(image: { data: Uint8Array; mimeType: string }): Promise<AvatarScreeningResult>;
}

export type AvatarScreeningResult =
  | { ok: true; decision: 'ok' | 'reject'; model: string }
  | { ok: false; error: string; model: string | null };

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 512;
const RESPONSE_JSON_SCHEMA = z.toJSONSchema(AvatarScreeningResponseSchema, { target: 'draft-7' });

export function createGeminiAvatarScreener(options: {
  models: GeminiModels;
  prompt: AvatarScreeningPrompt;
  model?: string;
  timeoutMs?: number;
  retry?: Parameters<typeof withTransientRetry>[1];
}): AvatarScreener {
  const model = options.model ?? options.prompt.model;
  const thinkingLevel =
    options.prompt.thinking_level && THINKING_LEVELS[options.prompt.thinking_level];
  return {
    async screen(image) {
      try {
        const contents = [
          {
            role: 'user',
            parts: [
              { text: options.prompt.user },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: Buffer.from(image.data).toString('base64'),
                },
              },
            ],
          },
        ];
        const response = await withTransientRetry(
          () =>
            options.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: options.prompt.system,
                temperature: 0,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
                responseMimeType: 'application/json',
                responseJsonSchema: RESPONSE_JSON_SCHEMA,
                abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
              },
            }),
          options.retry
        );
        return {
          ok: true,
          decision: parseStructuredResponse(response, AvatarScreeningResponseSchema).decision,
          model,
        };
      } catch (error) {
        return { ok: false, error: describeError(error), model };
      }
    },
  };
}

export const FAKE_AVATAR_SCREENER_MODEL = 'fake-avatar-screener';

/**
 * テストと E2E 用の偽の審査器。画像の左上の画素の色で結果が決まる (本物の API を呼ばない)。
 * 赤 (r > 200, g・b < 60) → 落とす / 青 (b > 200, r・g < 60) → 審査の失敗 / それ以外 → 通す
 */
export function createFakeAvatarScreener(): AvatarScreener {
  return {
    async screen(image) {
      const { data } = await sharp(image.data)
        .extract({ left: 0, top: 0, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const [r, g, b] = data;
      if (b > 200 && r < 60 && g < 60) {
        return { ok: false, error: 'fake failure', model: FAKE_AVATAR_SCREENER_MODEL };
      }
      const reject = r > 200 && g < 60 && b < 60;
      return { ok: true, decision: reject ? 'reject' : 'ok', model: FAKE_AVATAR_SCREENER_MODEL };
    },
  };
}

const screeners = new Map<string, AvatarScreener>();

/**
 * env から審査器を選ぶ (口コミの `getReviewScreener` と同じ決まり)。`REVIEW_SCREENER=fake` (手元とテストだけ) で偽物、
 * `GEMINI_API_KEY` で Gemini (モデルは `AVATAR_SCREENING_MODEL` か、プロンプトの既定)。どちらも無い・プロンプトが
 * 読めない時は必ず失敗を返す (画像は「確認できなかった」で落ち、公開されない)
 */
export async function getAvatarScreener(
  env: Record<string, string | undefined> = process.env,
  options: { templatesDir?: string } = {}
): Promise<AvatarScreener> {
  if (env.REVIEW_SCREENER === 'fake' && allowsFakeBackends(env)) {
    return createFakeAvatarScreener();
  }
  const apiKey = presentEnvValue(env.GEMINI_API_KEY);
  if (!apiKey) return failingScreener('GEMINI_API_KEY is not set');
  const model = presentEnvValue(env.AVATAR_SCREENING_MODEL);
  const dir = options.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const key = JSON.stringify([createHash('sha256').update(apiKey).digest('hex'), model, dir]);
  const cached = screeners.get(key);
  if (cached) return cached;
  const prompt = await loadAvatarScreeningPrompt(dir).catch(() => null);
  if (!prompt) return failingScreener('avatar screening prompt is missing or invalid');
  const screener = createGeminiAvatarScreener({
    models: new GoogleGenAI({ apiKey }).models,
    prompt,
    model,
  });
  screeners.set(key, screener);
  return screener;
}

function failingScreener(error: string): AvatarScreener {
  return { screen: async () => ({ ok: false, error, model: null }) };
}
