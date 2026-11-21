import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { presentEnvValue } from '@revolution/slack/env';

import { createFakeScreener } from './fake-screener';
import { createGeminiScreener } from './gemini-screener';
import { DEFAULT_TEMPLATES_DIR, loadScreeningPrompt } from './prompt';
import type { ReviewScreener } from './types';

export type { ReviewScreener, ReviewScreeningResult } from './types';

// 作った審査器を、鍵・モデル・プロンプトの置き場所ごとに覚える (提出のたびにファイルの読み込みと
// クライアントの生成をしない)。プロンプトが読めない時の審査器は覚えない (次の呼び出しで読み直す)
const screeners = new Map<string, ReviewScreener>();

/**
 * env から審査器を選ぶ。
 *
 * | env | 審査器 |
 * |---|---|
 * | `REVIEW_SCREENER=fake` (`NODE_ENV` が development か test の時だけ) | 偽物 (E2E・手元の確認) |
 * | `GEMINI_API_KEY` がある | Gemini。モデルは `REVIEW_SCREENING_MODEL` か、プロンプトの既定 |
 * | どちらも無い / プロンプトが読めない | 必ず失敗を返す審査器 (口コミは BOSS の確認待ちに回り、公開されない) |
 *
 * ビルドした物 (本番と Preview) では偽物を選ばない。設定の取り違えで、審査なしに公開されるのを防ぐ。
 */
export async function getReviewScreener(
  env: Record<string, string | undefined> = process.env,
  options: { templatesDir?: string } = {}
): Promise<ReviewScreener> {
  if (env.REVIEW_SCREENER === 'fake' && allowsFake(env)) {
    return createFakeScreener();
  }

  const apiKey = presentEnvValue(env.GEMINI_API_KEY);
  if (!apiKey) return failingScreener('GEMINI_API_KEY is not set');

  const model = presentEnvValue(env.REVIEW_SCREENING_MODEL);
  const dir = options.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const key = JSON.stringify([apiKey, model, dir]);
  const cached = screeners.get(key);
  if (cached) return cached;

  const prompt = await loadScreeningPrompt(dir).catch(() => null);
  if (!prompt) return failingScreener('screening prompt is missing or invalid');

  const screener = createGeminiScreener({
    models: new GoogleGenAI({ apiKey }).models,
    prompt,
    model,
  });
  screeners.set(key, screener);
  return screener;
}

/**
 * 偽物を使ってよいか。手元の開発とテスト (`NODE_ENV` が development か test) だけに限る。
 * Vercel の Preview も含めて、ビルドした物 (`NODE_ENV=production`) では使わない
 */
function allowsFake(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

function failingScreener(error: string): ReviewScreener {
  return { screen: async () => ({ ok: false, error, model: null }) };
}
