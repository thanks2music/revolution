import { readFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

import { DEFAULT_TEMPLATES_DIR } from '../screener/prompt';

/**
 * プロフィール画像の審査のプロンプト (revolution-templates の `reviews/avatar-screening.yaml`、one-more-time #171)。
 * 口コミの審査のプロンプト (`../screener/prompt.ts`) と同じ取り込み・同じ置き場所。
 * ビルドの時の形の検査 (`apps/frontend/scripts/check-review-prompt.ts`) からも読むので、`server-only` を置かない。
 * 下の形は、revolution-templates の CI (`validate-review-prompt.yml`) も同じ規則を持っている。変えたら向こうも合わせる
 */
const AvatarScreeningPromptSchema = z.object({
  version: z.number().int(),
  model: z.string().min(1),
  system: z.string().min(1),
  thinking_level: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  // 画像の前に置く指示。利用者の文を埋め込まないので、プレースホルダーは置かない
  user: z
    .string()
    .min(1)
    .refine(user => !user.includes('{{'), 'user must not contain placeholders'),
});
export type AvatarScreeningPrompt = z.infer<typeof AvatarScreeningPromptSchema>;

export async function loadAvatarScreeningPrompt(
  dir: string = DEFAULT_TEMPLATES_DIR
): Promise<AvatarScreeningPrompt> {
  const raw = await readFile(path.join(dir, 'reviews', 'avatar-screening.yaml'), 'utf8');
  return AvatarScreeningPromptSchema.parse(yaml.load(raw));
}
