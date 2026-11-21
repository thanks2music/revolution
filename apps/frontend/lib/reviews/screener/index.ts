import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { presentEnvValue } from '@revolution/slack/env';

import { createFakeScreener } from './fake-screener';
import { createGeminiScreener } from './gemini-screener';
import { loadScreeningPrompt } from './prompt';
import type { ReviewScreener } from './types';

export type { ReviewScreener, ReviewScreeningResult } from './types';

/**
 * env から審査器を選ぶ。
 *
 * | env | 審査器 |
 * |---|---|
 * | `REVIEW_SCREENER=fake` (本番以外) | 偽物 (E2E・手元の確認) |
 * | `GEMINI_API_KEY` がある | Gemini。モデルは `REVIEW_SCREENING_MODEL` か、プロンプトの既定 |
 * | どちらも無い / プロンプトが読めない | 必ず失敗を返す審査器 (口コミは BOSS の確認待ちに回り、公開されない) |
 *
 * 本番 (`VERCEL_ENV=production`。Vercel の外では `NODE_ENV=production`) では偽物を選ばない。
 * 設定の取り違えで、審査なしに公開されるのを防ぐ。
 */
export async function getReviewScreener(
  env: Record<string, string | undefined> = process.env,
  options: { templatesDir?: string } = {},
): Promise<ReviewScreener> {
  if (env.REVIEW_SCREENER === 'fake' && !isProduction(env)) {
    return createFakeScreener();
  }

  const apiKey = presentEnvValue(env.GEMINI_API_KEY);
  if (!apiKey) return failingScreener('GEMINI_API_KEY is not set');

  let prompt;
  try {
    prompt = await loadScreeningPrompt(options.templatesDir);
  } catch {
    return failingScreener('screening prompt is missing or invalid');
  }

  return createGeminiScreener({
    models: new GoogleGenAI({ apiKey }).models,
    prompt,
    model: presentEnvValue(env.REVIEW_SCREENING_MODEL),
  });
}

/** 本番か。Vercel の本番に加えて、Vercel の外で production として動かす時も本番とみなす */
function isProduction(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production';
}

function failingScreener(error: string): ReviewScreener {
  return { screen: async () => ({ ok: false, error, model: null }) };
}
