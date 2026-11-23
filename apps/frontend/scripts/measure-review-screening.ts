/**
 * 口コミの AI 審査を、templates repo の例文で計測する (モデルの選定・プロンプトの改修の回帰に使う)。
 *
 * **本物の Gemini を呼ぶ (費用がかかる)。CI では走らせない。**
 *
 * 使い方 (apps/frontend で):
 *   TEMPLATES_SOURCE_PATH=<templates repo> pnpm exec tsx scripts/measure-review-screening.ts <model> [<model> ...]
 *
 * - プロンプトは `reviews/screening.yaml`、例文は `reviews/screening-samples.yaml` (どちらも templates repo)
 * - GEMINI_API_KEY は環境変数か `.env.local` から読む (値は表示しない)
 * - 例文の本文は表示しない (外れた例文は番号と期待・結果だけを出す)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import yaml from 'js-yaml';
import { z } from 'zod';

import { createGeminiScreener, type GeminiModels } from '@revolution/reviews/screener/gemini-screener';
import { loadScreeningPrompt } from '@revolution/reviews/screener/prompt';

const SamplesSchema = z.object({
  samples: z.array(z.object({ expected: z.string(), body: z.string() })).min(1),
});

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) throw new Error('計測するモデルを引数で渡してください');

  const source = process.env.TEMPLATES_SOURCE_PATH;
  if (!source) throw new Error('TEMPLATES_SOURCE_PATH を設定してください');
  if (!process.env.GEMINI_API_KEY && existsSync('.env.local')) process.loadEnvFile('.env.local');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY がありません');

  const prompt = await loadScreeningPrompt(source);
  const { samples } = SamplesSchema.parse(
    yaml.load(readFileSync(path.join(source, 'reviews', 'screening-samples.yaml'), 'utf8')),
  );
  const client = new GoogleGenAI({ apiKey }).models;

  for (const model of models) {
    // 呼び出しを包んで、トークン数と時間を数える
    const usage = { input: 0, output: 0, ms: 0 };
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

    let correct = 0;
    let unsafePublish = 0;
    let failures = 0;
    const misses: string[] = [];
    for (const [index, sample] of samples.entries()) {
      const result = await screener.screen({ body: sample.body || null, photos: [] });
      const got = !result.ok
        ? `failure(${result.error})`
        : result.decision === 'reject'
          ? `reject:${result.reasonCode}`
          : result.decision;
      if (!result.ok) failures += 1;
      // unsure を期待する例は「publish 以外」なら正解 (迷った物を差し戻しても、公開するよりは安全)
      const ok =
        sample.expected === 'unsure'
          ? result.ok && result.decision !== 'publish'
          : got === sample.expected;
      if (ok) correct += 1;
      else misses.push(`  #${index + 1}: expected ${sample.expected}, got ${got}`);
      if (result.ok && result.decision === 'publish' && sample.expected !== 'publish') unsafePublish += 1;
    }

    console.log(`\n## ${model}`);
    console.log(`正解: ${correct}/${samples.length}  公開すべきでない物を公開: ${unsafePublish}  失敗: ${failures}`);
    console.log(
      `トークン: 入力 ${usage.input} / 出力 ${usage.output} (1 件あたり 入力 ${Math.round(usage.input / samples.length)} / 出力 ${Math.round(usage.output / samples.length)})`,
    );
    console.log(`時間: 平均 ${Math.round(usage.ms / samples.length)} ms / 件`);
    if (misses.length > 0) console.log(`外れ:\n${misses.join('\n')}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
