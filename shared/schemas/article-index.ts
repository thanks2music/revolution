import { z } from 'zod';
import { MdxFrontmatterSchema } from './mdx-frontmatter';

/**
 * Schema-SDD 真実源: article-index.json 構造
 *
 * Truth basis: apps/ai-writer/scripts/generate-article-index.ts 出力構造
 * 注: MdxFrontmatter から filePath を拡張。MdxFrontmatter で optional な配列フィールドは、
 *     generator が常に空配列で出力するため、ArticleIndex 側で required に override する
 *     (MdxFrontmatter 真実源 = 過去 PR 実態 / ArticleIndex 真実源 = generator 出力 と分離)。
 */
export const ArticleIndexItemSchema = MdxFrontmatterSchema.extend({
  filePath: z.string(),
  tags: z.array(z.string()),
  work_titles: z.array(z.string()),
  prefectures: z.array(z.string()),
  prefecture_slugs: z.array(z.string()),
});

export const ArticleIndexSchema = z
  .object({
    generatedAt: z.string().datetime({ precision: 3, offset: true }),
    totalArticles: z.number().int().nonnegative(),
    articles: z.array(ArticleIndexItemSchema),
  })
  .refine((d) => d.totalArticles === d.articles.length, {
    message: 'totalArticles must equal articles.length',
    path: ['totalArticles'],
  });

export type ArticleIndexItem = z.infer<typeof ArticleIndexItemSchema>;
export type ArticleIndex = z.infer<typeof ArticleIndexSchema>;
