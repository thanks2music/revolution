/**
 * Pipeline Mode Module
 *
 * Purpose:
 *   - Determine pipeline target (MDX or WordPress) based on environment variable
 *   - Provide helper functions for mode-specific logic branching
 *   - Default to MDX mode for production
 *
 * @module lib/pipeline-mode
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Section: MDXパイプライン本番運用のための実装漏れについて
 */

/**
 * Pipeline target types
 */
export type PipelineTarget = 'mdx' | 'wordpress';

/**
 * Get current pipeline target from environment variable
 *
 * @returns Pipeline target ('mdx' or 'wordpress')
 * @default 'mdx'
 *
 * @example
 * ```typescript
 * const target = getPipelineTarget();
 * console.log(target); // 'mdx' (default)
 *
 * // With PIPELINE_TARGET=wordpress
 * const target = getPipelineTarget();
 * console.log(target); // 'wordpress'
 * ```
 */
export function getPipelineTarget(): PipelineTarget {
  const target = process.env.PIPELINE_TARGET?.toLowerCase().trim();

  if (target === 'wordpress') {
    return 'wordpress';
  }

  // Default to MDX mode
  return 'mdx';
}

/**
 * Check if current pipeline mode is MDX
 *
 * @returns True if pipeline target is MDX
 *
 * @example
 * ```typescript
 * if (isMdxMode()) {
 *   await runMdxPipeline();
 * }
 * ```
 */
export function isMdxMode(): boolean {
  return getPipelineTarget() === 'mdx';
}

/**
 * Check if current pipeline mode is WordPress
 *
 * @returns True if pipeline target is WordPress
 *
 * @example
 * ```typescript
 * if (isWordPressMode()) {
 *   await runWordpressPipeline();
 * }
 * ```
 */
export function isWordPressMode(): boolean {
  return getPipelineTarget() === 'wordpress';
}

/**
 * Get pipeline mode description for logging
 *
 * @returns Human-readable mode description
 *
 * @example
 * ```typescript
 * console.log(`Pipeline mode: ${getPipelineModeDescription()}`);
 * // Output: "Pipeline mode: MDX (production)"
 * ```
 */
export function getPipelineModeDescription(): string {
  const target = getPipelineTarget();

  if (target === 'mdx') {
    return 'MDX (production)';
  }

  return 'WordPress (legacy)';
}
