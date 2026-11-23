/**
 * 口コミの AI 審査の、写真の枚数ごとのトークン数と時間を計る (one-more-time #164)。
 *
 * **本物の Gemini を呼ぶ (費用がかかる)。CI では走らせない。**
 *
 * 使い方 (apps/frontend で):
 *   TEMPLATES_SOURCE_PATH=<templates repo> pnpm exec tsx scripts/measure-review-photo-screening.ts [<model>]
 *
 * - 写真は審査に渡すのと同じ形 (720 幅の WebP) の、作った画像。トークン数は画像の大きさで決まり、中身には依らない
 * - 枚数は 0・1・3・10。各枚数を 3 回ずつ呼び、平均を出す
 * - GEMINI_API_KEY は環境変数か `.env.local` から読む (値は表示しない)
 */
import { existsSync } from 'node:fs';

import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import sharp from 'sharp';

import { createGeminiScreener, type GeminiModels } from '../lib/reviews/screener/gemini-screener';
import { loadScreeningPrompt } from '../lib/reviews/screener/prompt';

const COUNTS = [0, 1, 3, 10];
const RUNS = 3;

async function photo(seed: number) {
  const hue = (seed * 47) % 360;
  const data = await sharp({
    create: { width: 720, height: 540, channels: 3, background: `hsl(${hue}, 60%, 55%)` },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="720" height="540"><circle cx="${200 + seed * 30}" cy="270" r="120" fill="white"/><text x="40" y="80" font-size="48">Cafe ${seed}</text></svg>`
        ),
      },
    ])
    .webp({ quality: 80 })
    .toBuffer();
  return { data: new Uint8Array(data), mimeType: 'image/webp' };
}

async function main() {
  const source = process.env.TEMPLATES_SOURCE_PATH;
  if (!source) throw new Error('TEMPLATES_SOURCE_PATH を設定してください');
  if (!process.env.GEMINI_API_KEY && existsSync('.env.local')) process.loadEnvFile('.env.local');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY がありません');

  const prompt = await loadScreeningPrompt(source);
  const model = process.argv[2] ?? prompt.model;
  const client = new GoogleGenAI({ apiKey }).models;
  const photos = await Promise.all(Array.from({ length: 10 }, (_, i) => photo(i + 1)));

  console.log(`model ${model} / prompt version ${prompt.version}`);
  for (const count of COUNTS) {
    const usage = { input: 0, output: 0, ms: 0, failures: 0 };
    const counting: GeminiModels = {
      async generateContent(params: GenerateContentParameters) {
        const started = Date.now();
        const response = await client.generateContent(params);
        usage.ms += Date.now() - started;
        usage.input += response.usageMetadata?.promptTokenCount ?? 0;
        usage.output +=
          (response.usageMetadata?.candidatesTokenCount ?? 0) +
          (response.usageMetadata?.thoughtsTokenCount ?? 0);
        return response;
      },
    };
    const screener = createGeminiScreener({ models: counting, prompt, model });
    const decisions: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const result = await screener.screen({
        body: '平日の夕方に入れました。パフェが大きくて満足。',
        photos: photos.slice(0, count),
      });
      if (!result.ok) usage.failures += 1;
      decisions.push(
        result.ok
          ? `${result.decision}[${result.photos.map(p => p.decision).join(',')}]`
          : `failure(${result.error})`
      );
    }
    console.log(
      `photos ${count}: input ${Math.round(usage.input / RUNS)} / output ${Math.round(
        usage.output / RUNS
      )} tokens, ${Math.round(usage.ms / RUNS)} ms, failures ${usage.failures} — ${decisions.join(' ')}`
    );
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
