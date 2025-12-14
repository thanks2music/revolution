/**
 * GitHub PR Status Check Module
 *
 * Purpose:
 *   - Check if a PR exists and its status (open/closed)
 *   - Support duplicate detection logic
 *
 * @module lib/github/pr-status
 */

import { createGitHubClient } from './client';

const REPO_CONFIG = {
  owner: process.env.GITHUB_REPO_OWNER || 'thanks2music',
  repo: process.env.GITHUB_REPO_NAME || 'revolution',
} as const;

/**
 * Check if an open PR exists for the given canonical key
 *
 * @param canonicalKey - Event canonical key (e.g., "little-twin-stars:box-cafe-and-space:collabo-cafe:2025")
 * @returns true if an open PR exists, false otherwise
 *
 * @example
 * ```typescript
 * const hasOpenPr = await checkOpenPrByCanonicalKey("sample-work:avail:collabo-cafe:2025");
 * if (hasOpenPr) {
 *   console.log("Open PR exists");
 * }
 * ```
 */
export async function checkOpenPrByCanonicalKey(canonicalKey: string): Promise<boolean> {
  try {
    const octokit = await createGitHubClient();

    // Search for PRs by canonical key in title or body
    const { data: searchResult } = await octokit.search.issuesAndPullRequests({
      q: `repo:${REPO_CONFIG.owner}/${REPO_CONFIG.repo} is:pr is:open "${canonicalKey}"`,
    });

    return searchResult.total_count > 0;
  } catch (error) {
    console.warn('[PR Status] Failed to check open PR by canonical key:', error);
    // GitHub API エラーは警告のみ（Firestoreの重複チェックが主）
    return false;
  }
}

/**
 * Check if any PR (open or closed) exists for the given canonical key
 *
 * @param canonicalKey - Event canonical key
 * @returns PR status: { hasOpenPr: boolean, hasClosedPr: boolean, totalCount: number }
 *
 * @example
 * ```typescript
 * const status = await getPrStatusByCanonicalKey("sample-work:avail:collabo-cafe:2025");
 * if (status.hasClosedPr && !status.hasOpenPr) {
 *   console.log("PR was closed, allowing regeneration");
 * }
 * ```
 */
export async function getPrStatusByCanonicalKey(
  canonicalKey: string
): Promise<{
  hasOpenPr: boolean;
  hasClosedPr: boolean;
  totalCount: number;
}> {
  try {
    const octokit = await createGitHubClient();

    // Search for open PRs
    const { data: openPrs } = await octokit.search.issuesAndPullRequests({
      q: `repo:${REPO_CONFIG.owner}/${REPO_CONFIG.repo} is:pr is:open "${canonicalKey}"`,
    });

    // Search for closed PRs
    const { data: closedPrs } = await octokit.search.issuesAndPullRequests({
      q: `repo:${REPO_CONFIG.owner}/${REPO_CONFIG.repo} is:pr is:closed "${canonicalKey}"`,
    });

    return {
      hasOpenPr: openPrs.total_count > 0,
      hasClosedPr: closedPrs.total_count > 0,
      totalCount: openPrs.total_count + closedPrs.total_count,
    };
  } catch (error) {
    console.warn('[PR Status] Failed to get PR status by canonical key:', error);
    // GitHub API エラー時は安全側（重複と見なさない）
    return {
      hasOpenPr: false,
      hasClosedPr: false,
      totalCount: 0,
    };
  }
}
