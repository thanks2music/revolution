/**
 * MDX Template Generator Module
 *
 * Purpose:
 *   - Generate MDX frontmatter and file content
 *   - Create file paths following MVP URL structure
 *   - Support Phase 0.1 article generation
 *
 * @module lib/mdx/template-generator
 * @see {@link /notes/02-backlog/super-mvp-scope.md} for specification
 */

import { join } from 'path';
import type {
  MdxFrontmatter,
  MdxArticle,
  GenerateMdxFrontmatterInput,
} from './types';
import { MDX_DEFAULTS } from './types';

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
 *   workTitle: "呪術廻戦",
 *   workSlug: "jujutsu-kaisen",
 *   title: "呪術廻戦×アニメイトカフェ2025が東京で開催",
 *   excerpt: "呪術廻戦とアニメイトカフェのコラボが実現...",
 *   categories: ['呪術廻戦', 'コラボカフェ']
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
    workSlug,
    title,
    excerpt,
    categories,
    date = new Date().toISOString().split('T')[0], // YYYY-MM-DD
    author = MDX_DEFAULTS.AUTHOR,
    ogImage = MDX_DEFAULTS.OG_IMAGE,
  } = input;

  // Validation
  if (!postId || !year || !eventType || !workTitle || !workSlug) {
    throw new Error('Required frontmatter fields are missing');
  }

  if (!title || !excerpt || !categories || categories.length === 0) {
    throw new Error('Content fields (title, excerpt, categories) are required');
  }

  const slug = `${postId}-${year}`;

  return {
    post_id: postId,
    year,
    event_type: eventType,
    event_title: eventTitle,
    work_title: workTitle,
    work_slug: workSlug,
    slug,
    title,
    date,
    categories,
    excerpt,
    author,
    ogImage,
  };
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
export function serializeFrontmatter(frontmatter: MdxFrontmatter): string {
  const lines: string[] = ['---'];

  // Add each field
  lines.push(`post_id: "${frontmatter.post_id}"`);
  lines.push(`year: ${frontmatter.year}`);
  lines.push(`event_type: "${frontmatter.event_type}"`);
  lines.push(`event_title: "${frontmatter.event_title}"`);
  lines.push(`work_title: "${frontmatter.work_title}"`);
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

  // Optional fields
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

  lines.push('---');
  lines.push(''); // First newline after ---
  lines.push(''); // Second newline to create blank line

  return lines.join('\n');
}

/**
 * Generates file path for MDX article
 *
 * @description
 * Format: content/{event-type}/{work-slug}/{slug}.mdx
 * Example: content/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx
 *
 * @param {string} eventType - Event type slug (e.g., "collabo-cafe")
 * @param {string} workSlug - Work slug (e.g., "jujutsu-kaisen")
 * @param {string} slug - Article slug (e.g., "01jcxy4567-2025")
 * @param {string} baseDir - Base directory (defaults to "content")
 * @returns {string} Full file path
 *
 * @example
 * ```typescript
 * const path = generateMdxFilePath(
 *   "collabo-cafe",
 *   "jujutsu-kaisen",
 *   "01jcxy4567-2025"
 * );
 * console.log(path); // "content/collabo-cafe/jujutsu-kaisen/01jcxy4567-2025.mdx"
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
 *     workTitle: "呪術廻戦",
 *     workSlug: "jujutsu-kaisen",
 *     title: "呪術廻戦×アニメイトカフェ2025",
 *     excerpt: "...",
 *     categories: ['呪術廻戦', 'コラボカフェ']
 *   },
 *   "## イベント概要\n\n呪術廻戦とアニメイトカフェのコラボが実現..."
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
  if (!data || typeof data !== 'object') {
    return false;
  }

  const fm = data as Partial<MdxFrontmatter>;

  return (
    typeof fm.post_id === 'string' &&
    typeof fm.year === 'number' &&
    typeof fm.event_type === 'string' &&
    typeof fm.event_title === 'string' &&
    typeof fm.work_title === 'string' &&
    typeof fm.work_slug === 'string' &&
    typeof fm.slug === 'string' &&
    typeof fm.title === 'string' &&
    typeof fm.date === 'string' &&
    Array.isArray(fm.categories) &&
    typeof fm.excerpt === 'string' &&
    typeof fm.author === 'string' &&
    typeof fm.ogImage === 'string'
  );
}
