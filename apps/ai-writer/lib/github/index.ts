/**
 * GitHub Integration Module
 *
 * @module lib/github
 */

export { createGitHubClient, REPO_CONFIG, clearPatCache, wrapNetworkError } from './client';
export { createMdxPr, type CreateMdxPrParams, type CreateMdxPrResult } from './create-mdx-pr';
