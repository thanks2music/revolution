import { z } from 'zod';

/**
 * Schema-SDD 真実源: MDX frontmatter 構造
 *
 * Truth basis: 過去 11 件の "Generate MDX" PR から抽出した実 frontmatter
 * SoC 境界: 構造はパブリック (本ファイル)、slug の真実値は revolution-templates の YAML
 */
export const MdxFrontmatterSchema = z.object({
  post_id: z.string().min(1),
  year: z.number().int().min(2000).max(2050),
  event_type: z.string().min(1),
  event_title: z.string().min(1),
  work_title: z.string().min(1),
  work_slug: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  date: z.string().datetime({ precision: 3, offset: true }),
  categories: z.array(z.string()),
  excerpt: z.string().min(1),
  author: z.string().min(1),
  ogImage: z.string().nullable(),

  tags: z.array(z.string()).optional(),
  work_titles: z.array(z.string()).optional(),
  prefectures: z.array(z.string()).optional(),
  prefecture_slugs: z.array(z.string()).optional(),
  ai_provider: z.enum(['anthropic', 'gemini', 'openai']).optional(),
  ai_model: z.string().optional(),
});

export type MdxFrontmatter = z.infer<typeof MdxFrontmatterSchema>;
