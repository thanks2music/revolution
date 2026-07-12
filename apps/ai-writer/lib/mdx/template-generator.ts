/**
 * MDX Template Generator Module
 *
 * Purpose:
 *   - Generate MDX frontmatter and file content
 *   - Create file paths following MVP URL structure
 *   - Support Phase 0.1 article generation
 *
 * @module lib/mdx/template-generator
 * @see {@link /notes/archive/super-mvp-scope.md} for specification
 */

import { join } from 'path';
import { MdxFrontmatterSchema } from '@revolution/schemas/mdx-frontmatter';
import type {
  MdxFrontmatter,
  MdxArticle,
  GenerateMdxFrontmatterInput,
} from './types';
import { MDX_DEFAULTS } from './types';
import { toIsoMsDate } from '../utils/date';

/**
 * Generates MDX frontmatter from input parameters
 *
 * @param {GenerateMdxFrontmatterInput} input - Frontmatter generation parameters
 * @returns {MdxFrontmatter} Generated frontmatter
 *
 * @example
 * ```typescript
 * const frontmatter = generateMdxFrontmatter({
 *   postId: "01jcxy4567",
 *   year: 2025,
 *   eventType: "collabo-cafe",
 *   eventTitle: "コラボカフェ",
 *   workTitle: "作品名",
 *   workSlug: "work-slug",
 *   title: "作品名×店舗名2025が東京で開催",
 *   excerpt: "作品名と店舗名のコラボが実現...",
 *   categories: ['作品名', 'カテゴリ名']
 * });
 * ```
 */
export function generateMdxFrontmatter(
  input: GenerateMdxFrontmatterInput
): MdxFrontmatter {
  const {
    postId,
    year,
    eventType,
    eventTitle,
    workTitle,
    workTitles,
    workSlug,
    title,
    excerpt,
    categories,
    date = new Date().toISOString(), // ISO 8601 ms (Schema-SDD MdxFrontmatterSchema 適合)
    author = MDX_DEFAULTS.AUTHOR,
    ogImage = MDX_DEFAULTS.OG_IMAGE,
    // AI metadata (optional)
    aiProvider,
    aiModel,
    // Phase 1+ optional fields (URL設計v1.1 areas軸対応)
    prefectures,
    prefectureSlugs,
    tags,
    // Sprint C-α (MVP §11): EventFactCard 4 フィールド + event_data (Q4=C derived、Step 5.5 orchestrator から)
    eventStartDate,
    eventEndDate,
    venue,
    officialUrl,
    eventData,
  } = input;

  // Validation
  if (!postId || !year || !eventType || !workTitle || !workSlug) {
    throw new Error('Required frontmatter fields are missing');
  }

  if (!title || !excerpt || !categories || categories.length === 0) {
    throw new Error('Content fields (title, excerpt, categories) are required');
  }

  // slug is the same as postId (pure 10-character ULID)
  const slug = postId;

  const frontmatter: MdxFrontmatter = {
    post_id: postId,
    year,
    event_type: eventType,
    event_title: eventTitle,
    work_title: workTitle,
    work_slug: workSlug,
    slug,
    title,
    date: toIsoMsDate(date),
    categories,
    excerpt,
    author,
    ogImage,
  };

  // Add optional work_titles (複数作品コラボ対応)
  if (workTitles && workTitles.length > 0) {
    frontmatter.work_titles = workTitles;
  }

  // Add optional Phase 1+ fields (URL設計v1.1 areas軸対応)
  if (prefectures && prefectures.length > 0) {
    frontmatter.prefectures = prefectures;
  }

  if (prefectureSlugs && prefectureSlugs.length > 0) {
    frontmatter.prefecture_slugs = prefectureSlugs;
  }

  // Add optional tags (将来拡張用)
  if (tags && tags.length > 0) {
    frontmatter.tags = tags;
  }

  // Add AI metadata (optional)
  if (aiProvider) {
    frontmatter.ai_provider = aiProvider;
  }

  if (aiModel) {
    frontmatter.ai_model = aiModel;
  }

  // Sprint C-α (MVP §11): EventFactCard 4 フィールド + event_data (Q4=C derived、Step 5.5 orchestrator から)
  // Frontend の EventFactCard コンポーネントが「あと N 日」黄色バッジ表示に使用。
  // undefined フィールドは serialize しない (MdxFrontmatterSchema は optional)。
  if (eventStartDate !== undefined) {
    frontmatter.event_start_date = eventStartDate;
  }
  if (eventEndDate !== undefined) {
    frontmatter.event_end_date = eventEndDate;
  }
  if (venue !== undefined) {
    frontmatter.venue = venue;
  }
  if (officialUrl !== undefined) {
    frontmatter.official_url = officialUrl;
  }
  if (eventData !== undefined) {
    frontmatter.event_data = eventData;
  }

  return frontmatter;
}

/**
 * Serializes frontmatter to YAML format
 *
 * @param {MdxFrontmatter} frontmatter - Frontmatter object
 * @returns {string} YAML-formatted frontmatter
 *
 * @example
 * ```typescript
 * const yaml = serializeFrontmatter(frontmatter);
 * console.log(yaml);
 * // ---
 * // post_id: "01jcxy4567"
 * // year: 2025
 * // ...
 * // ---
 * ```
 */
/**
 * YAML double-quoted scalar 内で危険な文字を escape する。
 *
 * @description
 * YAML 1.2 の double-quoted scalars は C-style escape を解釈するため、backslash (\)
 * と double-quote (") の両方を escape する必要がある。旧 pattern
 * (`.replace(/"/g, '\\"')`) は backslash 未対応で、literal `\` を含む値が来ると
 * `\n` (改行) / `\t` (タブ) / `\b` (バックスペース) 等の C-style escape として解釈され
 * 不正な YAML を生成する可能性がある。
 *
 * @param s escape 対象の文字列
 * @returns backslash + double-quote を escape 済の文字列
 *
 * @remarks
 * Sprint C-α PR #268 R1 対応 (claude[bot] comment #2/#4/#5/#6 の YAML escape ギャップ指摘)。
 * 本関数は Sprint C-α で新規追加した箇所 (`venue`, `event_data.occurrences[].venue_label`)
 * にのみ適用する。既存の他 escape 箇所 (`title` / `excerpt` / `categories[]` / 他 array
 * 系全 10+ 箇所) は Sprint Refactor-A で `yaml.dump` への統一と合わせて修正予定
 * (comment #5 の 5. 提案方向性)。
 */
function escapeYamlDoubleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function serializeFrontmatter(frontmatter: MdxFrontmatter): string {
  const lines: string[] = ['---'];

  // Add each field
  lines.push(`post_id: "${frontmatter.post_id}"`);
  lines.push(`year: ${frontmatter.year}`);
  lines.push(`event_type: "${frontmatter.event_type}"`);
  lines.push(`event_title: "${frontmatter.event_title}"`);
  lines.push(`work_title: "${frontmatter.work_title}"`);

  // Optional: work_titles array (複数作品コラボ対応)
  if (frontmatter.work_titles && frontmatter.work_titles.length > 0) {
    const workTitlesYaml = frontmatter.work_titles
      .map((title) => `"${title.replace(/"/g, '\\"')}"`)
      .join(', ');
    lines.push(`work_titles: [${workTitlesYaml}]`);
  }

  lines.push(`work_slug: "${frontmatter.work_slug}"`);
  lines.push(`slug: "${frontmatter.slug}"`);

  // Escape quotes in title and excerpt
  const escapedTitle = frontmatter.title.replace(/"/g, '\\"');
  const escapedExcerpt = frontmatter.excerpt.replace(/"/g, '\\"');

  lines.push(`title: "${escapedTitle}"`);
  lines.push(`date: "${frontmatter.date}"`);

  // Categories array
  const categoriesYaml = frontmatter.categories
    .map((cat) => `"${cat.replace(/"/g, '\\"')}"`)
    .join(', ');
  lines.push(`categories: [${categoriesYaml}]`);

  lines.push(`excerpt: "${escapedExcerpt}"`);
  lines.push(`author: "${frontmatter.author}"`);
  lines.push(`ogImage: "${frontmatter.ogImage}"`);

  // AI metadata (optional)
  if (frontmatter.ai_provider) {
    const escapedProvider = frontmatter.ai_provider.replace(/"/g, '\\"');
    lines.push(`ai_provider: "${escapedProvider}"`);
  }

  if (frontmatter.ai_model) {
    const escapedModel = frontmatter.ai_model.replace(/"/g, '\\"');
    lines.push(`ai_model: "${escapedModel}"`);
  }

  // Optional fields - venues (legacy)
  if (frontmatter.venues && frontmatter.venues.length > 0) {
    const venuesYaml = frontmatter.venues
      .map((venue) => `"${venue.replace(/"/g, '\\"')}"`)
      .join(', ');
    lines.push(`venues: [${venuesYaml}]`);
  }

  if (frontmatter.venue_slugs && frontmatter.venue_slugs.length > 0) {
    const venueSlugsYaml = frontmatter.venue_slugs
      .map((slug) => `"${slug}"`)
      .join(', ');
    lines.push(`venue_slugs: [${venueSlugsYaml}]`);
  }

  // Optional fields - Phase 1+ (URL設計v1.1 areas軸対応)
  if (frontmatter.prefectures && frontmatter.prefectures.length > 0) {
    const prefecturesYaml = frontmatter.prefectures
      .map((pref) => `"${pref.replace(/"/g, '\\"')}"`)
      .join(', ');
    lines.push(`prefectures: [${prefecturesYaml}]`);
  }

  if (frontmatter.prefecture_slugs && frontmatter.prefecture_slugs.length > 0) {
    const prefectureSlugsYaml = frontmatter.prefecture_slugs
      .map((slug) => `"${slug}"`)
      .join(', ');
    lines.push(`prefecture_slugs: [${prefectureSlugsYaml}]`);
  }

  // Optional fields - tags (将来拡張用)
  if (frontmatter.tags && frontmatter.tags.length > 0) {
    const tagsYaml = frontmatter.tags
      .map((tag) => `"${tag.replace(/"/g, '\\"')}"`)
      .join(', ');
    lines.push(`tags: [${tagsYaml}]`);
  }

  // ---------------------------------------------------------------------------
  // Sprint C-α (MVP §11): EventFactCard 4 フィールド + 開催ブロック雛形 event_data
  // ---------------------------------------------------------------------------
  // Frontend の EventFactCard コンポーネントが「あと N 日」黄色バッジ表示に使用する
  // 4 フィールド (event_start_date / event_end_date / venue / official_url) と、
  // 機械可読の開催ブロック雛形 event_data を frontmatter に serialize。
  //
  // - 4 フィールドは Q4=C の deterministic mapping (event-fact-card-mapper.ts) で導出済
  // - event_data は Zod EventDataSchema で validate 済 (Step 5.5 orchestrator で parse)
  // - undefined フィールドは serialize しない (MdxFrontmatterSchema は optional)
  // - event_data は nested YAML として serialize (primary_category_slug / title_slugs[] /
  //   supplementary_category_slugs[] / occurrences[])
  // ---------------------------------------------------------------------------

  if (frontmatter.event_start_date) {
    lines.push(`event_start_date: "${frontmatter.event_start_date}"`);
  }
  if (frontmatter.event_end_date) {
    lines.push(`event_end_date: "${frontmatter.event_end_date}"`);
  }
  if (frontmatter.venue) {
    // Sprint C-α PR #268 R1: backslash も escape する helper に統一 (claude[bot] R1)
    const escapedVenue = escapeYamlDoubleQuoted(frontmatter.venue);
    lines.push(`venue: "${escapedVenue}"`);
  }
  if (frontmatter.official_url) {
    lines.push(`official_url: "${frontmatter.official_url}"`);
  }

  // event_data (nested YAML): Sprint C-α で新設、Zod EventDataSchema 準拠
  if (frontmatter.event_data) {
    const ed = frontmatter.event_data;
    lines.push('event_data:');
    lines.push(`  primary_category_slug: "${ed.primary_category_slug}"`);

    // title_slugs[] (常に配列、Zod schema で必須)
    const titleSlugsYaml = ed.title_slugs
      .map((slug) => `"${slug}"`)
      .join(', ');
    lines.push(`  title_slugs: [${titleSlugsYaml}]`);

    // supplementary_category_slugs[] (optional、maxItems: 2)
    if (ed.supplementary_category_slugs && ed.supplementary_category_slugs.length > 0) {
      const suppSlugsYaml = ed.supplementary_category_slugs
        .map((slug) => `"${slug}"`)
        .join(', ');
      lines.push(`  supplementary_category_slugs: [${suppSlugsYaml}]`);
    }

    // occurrences[] (optional、MVP は通常 1 要素)
    if (ed.occurrences && ed.occurrences.length > 0) {
      lines.push('  occurrences:');
      for (const occ of ed.occurrences) {
        lines.push(`    - venue_slug: ${occ.venue_slug === null ? 'null' : `"${occ.venue_slug}"`}`);
        if (occ.venue_label !== null) {
          // Sprint C-α PR #268 R1: backslash も escape する helper に統一 (claude[bot] R1)
          const escapedLabel = escapeYamlDoubleQuoted(occ.venue_label);
          lines.push(`      venue_label: "${escapedLabel}"`);
        } else {
          lines.push(`      venue_label: null`);
        }
        lines.push(`      starts_on: "${occ.starts_on}"`);
        lines.push(`      ends_on: ${occ.ends_on === null ? 'null' : `"${occ.ends_on}"`}`);
        lines.push(`      official_url: ${occ.official_url === null ? 'null' : `"${occ.official_url}"`}`);
      }
    }
  }

  lines.push('---');
  lines.push(''); // First newline after ---
  lines.push(''); // Second newline to create blank line

  return lines.join('\n');
}

/**
 * Generates file path for MDX article
 *
 * @description
 * Format: content/{event-type}/{work-slug}/{post-id}.mdx
 * Example: content/collabo-cafe/sample-work/01jcxy4567.mdx
 *
 * @param {string} eventType - Event type slug (e.g., "collabo-cafe")
 * @param {string} workSlug - Work slug (e.g., "sample-work")
 * @param {string} slug - Article slug (e.g., "01jcxy4567")
 * @param {string} baseDir - Base directory (defaults to "content")
 * @returns {string} Full file path
 *
 * @example
 * ```typescript
 * const path = generateMdxFilePath(
 *   "collabo-cafe",
 *   "sample-work",
 *   "01jcxy4567"
 * );
 * console.log(path); // "content/collabo-cafe/sample-work/01jcxy4567.mdx"
 * ```
 */
export function generateMdxFilePath(
  eventType: string,
  workSlug: string,
  slug: string,
  baseDir: string = MDX_DEFAULTS.CONTENT_BASE_DIR
): string {
  return join(baseDir, eventType, workSlug, `${slug}.mdx`);
}

/**
 * Generates complete MDX article with frontmatter and content
 *
 * @param {GenerateMdxFrontmatterInput} input - Article generation parameters
 * @param {string} content - Article body content (Markdown)
 * @param {string} baseDir - Base directory for content (defaults to "content")
 * @returns {MdxArticle} Complete MDX article structure
 *
 * @example
 * ```typescript
 * const article = generateMdxArticle(
 *   {
 *     postId: "01jcxy4567",
 *     year: 2025,
 *     eventType: "collabo-cafe",
 *     eventTitle: "コラボカフェ",
 *     workTitle: "作品名",
 *     workSlug: "work-slug",
 *     title: "作品名×店舗名2025",
 *     excerpt: "...",
 *     categories: ['作品名', 'カテゴリ名']
  *   },
 *   "## イベント概要\n\n作品名と店舗名のコラボが実現..."
 * );
 *
 * console.log(article.filePath);
 * console.log(article.frontmatter);
 * console.log(article.content); // Full MDX with frontmatter + body
 * ```
 */
export function generateMdxArticle(
  input: GenerateMdxFrontmatterInput,
  content: string,
  baseDir: string = MDX_DEFAULTS.CONTENT_BASE_DIR
): MdxArticle {
  // Generate frontmatter
  const frontmatter = generateMdxFrontmatter(input);

  // Serialize frontmatter to YAML
  const frontmatterYaml = serializeFrontmatter(frontmatter);

  // Combine frontmatter + content
  const fullContent = `${frontmatterYaml}${content}`;

  // Generate file path
  const filePath = generateMdxFilePath(
    frontmatter.event_type,
    frontmatter.work_slug,
    frontmatter.slug,
    baseDir
  );

  return {
    frontmatter,
    content: fullContent,
    filePath,
  };
}

/**
 * Validates MDX frontmatter structure
 *
 * @param {unknown} data - Data to validate
 * @returns {boolean} True if valid frontmatter structure
 *
 * @example
 * ```typescript
 * const isValid = isValidMdxFrontmatter(frontmatter);
 * if (!isValid) {
 *   throw new Error('Invalid frontmatter structure');
 * }
 * ```
 */
export function isValidMdxFrontmatter(data: unknown): data is MdxFrontmatter {
  return MdxFrontmatterSchema.safeParse(data).success;
}
