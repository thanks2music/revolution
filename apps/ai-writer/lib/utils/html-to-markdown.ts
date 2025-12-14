/**
 * HTML to Markdown Converter
 *
 * Purpose:
 *   - Convert common HTML tags to Markdown format
 *   - Clean up RSS content for MDX article generation
 *   - Support basic formatting tags (bold, italic, links, etc.)
 *
 * @module lib/utils/html-to-markdown
 */

/**
 * HTML to Markdown conversion rules
 */
const HTML_TO_MD_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // Bold tags: <b>, <strong>
  { pattern: /<\s*b\s*>(.*?)<\s*\/\s*b\s*>/gi, replacement: '**$1**' },
  { pattern: /<\s*strong\s*>(.*?)<\s*\/\s*strong\s*>/gi, replacement: '**$1**' },

  // Italic tags: <i>, <em>
  { pattern: /<\s*i\s*>(.*?)<\s*\/\s*i\s*>/gi, replacement: '*$1*' },
  { pattern: /<\s*em\s*>(.*?)<\s*\/\s*em\s*>/gi, replacement: '*$1*' },

  // Underline tags: <u> → retain as HTML (no Markdown equivalent)
  // Links: <a href="url">text</a>
  {
    pattern: /<\s*a\s+href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\s*\/\s*a\s*>/gi,
    replacement: '[$2]($1)',
  },

  // Headings: <h1> to <h6>
  { pattern: /<\s*h1\s*>(.*?)<\s*\/\s*h1\s*>/gi, replacement: '# $1' },
  { pattern: /<\s*h2\s*>(.*?)<\s*\/\s*h2\s*>/gi, replacement: '## $1' },
  { pattern: /<\s*h3\s*>(.*?)<\s*\/\s*h3\s*>/gi, replacement: '### $1' },
  { pattern: /<\s*h4\s*>(.*?)<\s*\/\s*h4\s*>/gi, replacement: '#### $1' },
  { pattern: /<\s*h5\s*>(.*?)<\s*\/\s*h5\s*>/gi, replacement: '##### $1' },
  { pattern: /<\s*h6\s*>(.*?)<\s*\/\s*h6\s*>/gi, replacement: '###### $1' },

  // Paragraphs: <p> → double newline
  { pattern: /<\s*p\s*>(.*?)<\s*\/\s*p\s*>/gi, replacement: '\n\n$1\n\n' },

  // Line breaks: <br>, <br/>
  { pattern: /<\s*br\s*\/?>/gi, replacement: '\n' },

  // Lists: <ul>, <ol>, <li>
  { pattern: /<\s*\/\s*ul\s*>/gi, replacement: '\n' },
  { pattern: /<\s*\/\s*ol\s*>/gi, replacement: '\n' },
  { pattern: /<\s*li\s*>(.*?)<\s*\/\s*li\s*>/gi, replacement: '- $1\n' },

  // Code: <code>, <pre>
  { pattern: /<\s*code\s*>(.*?)<\s*\/\s*code\s*>/gi, replacement: '`$1`' },
  { pattern: /<\s*pre\s*>(.*?)<\s*\/\s*pre\s*>/gi, replacement: '```\n$1\n```' },

  // Blockquote: <blockquote>
  { pattern: /<\s*blockquote\s*>(.*?)<\s*\/\s*blockquote\s*>/gi, replacement: '> $1' },

  // Remove remaining HTML tags (cleanup)
  { pattern: /<[^>]+>/g, replacement: '' },
];

/**
 * Converts HTML content to Markdown format
 *
 * @description
 * Applies conversion rules to transform common HTML tags into Markdown syntax.
 * Useful for cleaning RSS feed content before MDX generation.
 *
 * Features:
 * - Bold/italic formatting
 * - Links and headings
 * - Lists and code blocks
 * - Removes unsupported HTML tags
 *
 * @param {string} html - HTML content to convert
 * @returns {string} Markdown-formatted content
 *
 * @example
 * ```typescript
 * const html = '<b>Hello</b> <i>World</i>!';
 * const markdown = convertHtmlToMarkdown(html);
 * console.log(markdown); // "**Hello** *World*!"
 * ```
 *
 * @example
 * ```typescript
 * const html = '<p>Check out <a href="https://example.com">this link</a>!</p>';
 * const markdown = convertHtmlToMarkdown(html);
 * console.log(markdown); // "\n\nCheck out [this link](https://example.com)!\n\n"
 * ```
 */
export function convertHtmlToMarkdown(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  let markdown = html;

  // Apply all conversion rules
  for (const rule of HTML_TO_MD_RULES) {
    markdown = markdown.replace(rule.pattern, rule.replacement);
  }

  // Clean up excessive whitespace
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/ {2,}/g, ' ') // Max 1 space between words
    .trim();

  return markdown;
}

/**
 * Converts RSS content to Markdown
 *
 * @description
 * Wrapper for convertHtmlToMarkdown() with RSS-specific handling.
 * Handles both HTML and plain text content gracefully.
 *
 * @param {string} content - RSS content (HTML or plain text)
 * @returns {string} Markdown-formatted content
 *
 * @example
 * ```typescript
 * const rssContent = rssItem.content || rssItem.contentSnippet || '';
 * const markdown = convertRssContentToMarkdown(rssContent);
 * ```
 */
export function convertRssContentToMarkdown(content: string): string {
  // If content has no HTML tags, return as-is
  if (!content || !content.includes('<')) {
    return content;
  }

  return convertHtmlToMarkdown(content);
}
