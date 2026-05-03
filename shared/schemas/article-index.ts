import { z } from 'zod';
import { MdxFrontmatterSchema } from './mdx-frontmatter';

/**
 * Schema-SDD 真実源: article-index.json 構造
 *
 * Truth basis: apps/ai-writer/scripts/generate-article-index.ts 出力構造
 * 注: MdxFrontmatter から filePath を拡張。date は MdxFrontmatter 継承で ISO 8601 ms に統一。
 */
export const ArticleIndexItemSchema = MdxFrontmatterSchema.extend({
  filePath: z.string(),
});

export const ArticleIndexSchema = z.object({
  generatedAt: z.string().datetime({ precision: 3, offset: true }),
  totalArticles: z.number().int().nonnegative(),
  articles: z.array(ArticleIndexItemSchema),
});

export type ArticleIndexItem = z.infer<typeof ArticleIndexItemSchema>;
export type ArticleIndex = z.infer<typeof ArticleIndexSchema>;
