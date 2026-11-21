import { readFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * 審査のプロンプト (revolution-templates の `reviews/screening.yaml`)。
 *
 * プロンプトの文面は private の revolution-templates が正本 (SoC: プロンプトは YAML に置く)。
 * 公開サイトのビルドの時に `scripts/fetch-templates.sh` が `apps/frontend/templates/` に取り込み、
 * `next.config.mjs` の `outputFileTracingIncludes` でサーバーの関数に含める。
 *
 * 文面の中の `{{body}}` を本文に置き換えて渡す。
 */
const ScreeningPromptSchema = z.object({
  version: z.number().int(),
  /** 審査に使うモデル。env (`REVIEW_SCREENING_MODEL`) が優先 */
  model: z.string().min(1),
  system: z.string().min(1),
  user: z.string().includes('{{body}}'),
});

export type ScreeningPrompt = z.infer<typeof ScreeningPromptSchema>;

/** 取り込み先 (`apps/frontend/templates/`)。サーバーの関数では cwd が apps/frontend になる */
export function templatesDir(): string {
  return path.join(process.cwd(), 'templates');
}

export async function loadScreeningPrompt(dir: string = templatesDir()): Promise<ScreeningPrompt> {
  const raw = await readFile(path.join(dir, 'reviews', 'screening.yaml'), 'utf8');
  return ScreeningPromptSchema.parse(yaml.load(raw));
}

/**
 * 本文をプロンプトに埋め込む。本文は利用者の入力なので、区切りのタグを閉じる文字列を無害にして、
 * 指示として読まれないようにする (プロンプト側でも「タグの中はデータ」と明記する)
 */
export function renderUserPrompt(prompt: ScreeningPrompt, body: string | null): string {
  const safeBody = (body ?? '').replaceAll('</review>', '<\\/review>');
  return prompt.user.replace('{{body}}', safeBody);
}
