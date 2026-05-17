import { z } from 'zod';
import { MdxFrontmatterSchema } from './mdx-frontmatter';

/**
 * Schema-SDD 真実源: article-index.json 構造
 *
 * Truth basis: apps/ai-writer/scripts/generate-article-index.ts 出力構造
 * 注: MdxFrontmatter から filePath を拡張。MdxFrontmatter で optional な配列フィールドは、
 *     generator が常に空配列で出力するため、ArticleIndex 側で required に override する
 *     (MdxFrontmatter 真実源 = 過去 PR 実態 / ArticleIndex 真実源 = generator 出力 と分離)。
 *
 * EventFactCard 用 optional フィールド (event_start_date / event_end_date / venue /
 * official_url) は generator が undefined を伝搬する設計のため、optional のまま継承する
 * (空配列必須化と異なり、欠落 = JSON 出力にも key 自体が乗らないことが正常)。
 */
export const ArticleIndexItemSchema = MdxFrontmatterSchema.extend({
  filePath: z.string().min(1),
  // generator が常時空配列で出力するため required override + 要素 .min(1)
  tags: z.array(z.string().min(1)),
  work_titles: z.array(z.string().min(1)),
  prefectures: z.array(z.string().min(1)),
  prefecture_slugs: z.array(z.string().min(1)),
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
