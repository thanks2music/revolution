import { z } from 'zod';

/**
 * `pipeline/6-meta-description.yaml` の応答 (記事の抜粋、2026-10-16)。
 *
 * 抜粋は frontmatter の `excerpt` になり、メタディスクリプションと記事一覧のカードに出る。
 * OpenAI の Structured Outputs (strict) に通すため、項目は必須にする。
 */
export const ExcerptResponseSchema = z.object({
  /** 1 段落の抜粋。字数の上限を超えたら Revolution が切り詰める */
  excerpt: z.string(),
});

export type ExcerptResponse = z.infer<typeof ExcerptResponseSchema>;
