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
 * 本文をプロンプトに埋め込む。本文は利用者の入力なので、`<` と `>` をすべて全角に置き換え、
 * 区切りのタグ (`<review>`) を閉じたり新しく作ったりできないようにする。大文字・空白入りの
 * `</REVIEW >` などの書き方も含めて防ぐため、特定の文字列ではなく文字ごと置き換える
 * (審査には影響しない。プロンプト側でも「タグの中はデータ」と明記している)
 */
export function renderUserPrompt(prompt: ScreeningPrompt, body: string | null): string {
  const safeBody = (body ?? '').replaceAll('<', '＜').replaceAll('>', '＞');
  // 置き換えの文字列の `$&` などを特別扱いさせないため、関数で渡す
  return prompt.user.replace('{{body}}', () => safeBody);
}
