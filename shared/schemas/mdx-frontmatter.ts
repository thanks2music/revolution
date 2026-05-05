import { z } from 'zod';

/**
 * Schema-SDD 真実源: MDX frontmatter 構造
 *
 * Truth basis: 過去 11 件の "Generate MDX" PR から抽出した実 frontmatter
 * SoC 境界: 構造はパブリック (本ファイル)、slug の真実値は revolution-templates の YAML
 *
 * 注: `date` は ISO 8601 ms (datetime({ precision: 3, offset: true })) 限定の forward-looking
 * 契約。リポジトリ内 sample-work/01kafsdmvd.mdx の plain YYYY-MM-DD は別タスクで再生成予定で、
 * 移行完了までは本スキーマで parse 失敗するのが想定動作。
 */
export const MdxFrontmatterSchema = z.object({
  post_id: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  event_type: z.string().min(1),
  event_title: z.string().min(1),
  work_title: z.string().min(1),
  work_slug: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  date: z.string().datetime({ precision: 3, offset: true }),
  categories: z.array(z.string().min(1)),
  excerpt: z.string().min(1),
  author: z.string().min(1),
  // nullable + 非 optional: generator は frontmatter.ogImage が空なら null を出力するため
  // (apps/ai-writer/scripts/generate-article-index.ts:271)、key の欠落 (undefined) は受け付けない
  ogImage: z.string().nullable(),

  // 配列要素も .min(1) 強制: 空文字 tag/slug は不正データ扱い (categories と同等)
  tags: z.array(z.string().min(1)).optional(),
  work_titles: z.array(z.string().min(1)).optional(),
  prefectures: z.array(z.string().min(1)).optional(),
  prefecture_slugs: z.array(z.string().min(1)).optional(),
  ai_provider: z.enum(['anthropic', 'gemini', 'openai']).optional(),
  ai_model: z.string().optional(),

  // Legacy: 過去 MDX 互換のため optional として温存 (現行 generator は prefectures/prefecture_slugs を使用)
  venues: z.array(z.string().min(1)).optional(),
  venue_slugs: z.array(z.string().min(1)).optional(),
});

export type MdxFrontmatter = z.infer<typeof MdxFrontmatterSchema>;
