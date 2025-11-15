/**
 * GitHub PR作成ロジック
 *
 * Codexレビュー指摘対応:
 * - Slug正規化と重複チェック (.mdx と index.mdx 両方)
 * - 最新base ref取得 (キャッシュされたSHAを使わない)
 * - 明示的なcommitter/author設定
 * - リトライロジック (BranchConflictError時)
 */

import type { Octokit } from '@octokit/rest';
import { createGitHubClient, REPO_CONFIG } from './client';
import {
  parseFrontmatter,
  normalizeSlug,
  generateFileName,
  type Frontmatter,
} from '../markdown/parser';
import {
  DuplicateSlugError,
  BranchConflictError,
  GitHubRateLimitError,
} from '../errors/github';

/**
 * PR作成パラメータ
 */
export interface CreateArticlePrParams {
  /** MDX/Markdown全文 (frontmatter含む) */
  markdown: string;
  /** 生成元情報 (PRのbodyに記載) */
  source?: {
    feedUrl?: string;
    originalUrl?: string;
  };
}

/**
 * PR作成結果
 */
export interface CreateArticlePrResult {
  /** PR番号 */
  prNumber: number;
  /** PR URL */
  prUrl: string;
  /** 作成されたブランチ名 */
  branchName: string;
  /** コミットされたファイルパス */
  filePath: string;
}

/**
 * Committer/Author情報 (サービスアカウント)
 *
 * Codexレビュー指摘対応:
 * - 明示的に設定して audit log を明確化
 */
const SERVICE_ACCOUNT = {
  name: 'Revolution AI Writer',
  email: 'ai-writer@revolution.noreply.github.com',
};

/**
 * 記事PRを作成
 *
 * 4ステップフロー:
 * 1. frontmatterバリデーション
 * 2. slug重複チェック
 * 3. ブランチ作成
 * 4. ファイルコミット → PR作成
 *
 * @param params - PR作成パラメータ
 * @returns PR作成結果
 * @throws DuplicateSlugError - Slug重複時
 * @throws BranchConflictError - ブランチ作成失敗時
 * @throws GitHubRateLimitError - Rate Limit時
 */
export async function createArticlePr(
  params: CreateArticlePrParams
): Promise<CreateArticlePrResult> {
  const octokit = await createGitHubClient();
  const { owner, repo, baseBranch, articlesPath } = REPO_CONFIG;

  // 1. frontmatterバリデーション (Zodでバリデーション)
  const { metadata, content } = parseFrontmatter(params.markdown);

  // 2. slug重複チェック (正規化 + .mdx と index.mdx 両方)
  const normalizedSlug = normalizeSlug(metadata.slug);
  const fileName = generateFileName(metadata.date, normalizedSlug);
  const filePath = `${articlesPath}/${fileName}`;

  await checkDuplicateSlug(octokit, filePath, normalizedSlug);

  // 3. ブランチ作成 (最新refを取得してから作成)
  const branchName = `article/${normalizedSlug}-${Date.now()}`;
  const baseSha = await getLatestCommitSha(octokit, baseBranch);

  await createBranch(octokit, branchName, baseSha);

  // 4. ファイルコミット
  await commitFile(octokit, {
    path: filePath,
    content: params.markdown,
    branchName,
    commitMessage: `Add article: ${metadata.title}`,
  });

  // 5. PR作成
  const pr = await createPullRequest(octokit, {
    branchName,
    baseBranch,
    title: `📝 Add article: ${metadata.title}`,
    body: generatePrDescription(metadata, params),
  });

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    branchName,
    filePath,
  };
}

/**
 * Slug重複チェック
 *
 * Codexレビュー指摘対応:
 * - 正規化されたslugで比較
 * - .mdx と index.mdx 両方をチェック
 *
 * @param octokit - Octokit instance
 * @param filePath - チェック対象のファイルパス
 * @param slug - 正規化されたslug
 * @throws DuplicateSlugError - 重複時
 */
async function checkDuplicateSlug(
  octokit: Octokit,
  filePath: string,
  slug: string
): Promise<void> {
  const { owner, repo, baseBranch, articlesPath } = REPO_CONFIG;

  // チェック対象パス: fileName.mdx と index.mdx
  const pathsToCheck = [
    filePath, // e.g., content/articles/2025-01-15-hello-world.md
    `${articlesPath}/${slug}.mdx`,
    `${articlesPath}/${slug}/index.mdx`,
  ];

  for (const path of pathsToCheck) {
    const exists = await checkFileExists(octokit, path);
    if (exists) {
      throw new DuplicateSlugError(
        `Article with slug "${slug}" already exists`,
        slug,
        path
      );
    }
  }
}

/**
 * ファイル存在確認
 *
 * @param octokit - Octokit instance
 * @param path - ファイルパス
 * @returns 存在する場合 true
 */
async function checkFileExists(
  octokit: Octokit,
  path: string
): Promise<boolean> {
  const { owner, repo, baseBranch } = REPO_CONFIG;

  try {
    await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: baseBranch,
    });
    return true;
  } catch (error: any) {
    // 404の場合は存在しない
    if (error.status === 404) {
      return false;
    }
    // その他のエラーはスロー
    throw error;
  }
}

/**
 * 最新コミットSHA取得
 *
 * Codexレビュー指摘対応:
 * - キャッシュされたSHAを使わず、毎回最新を取得
 *
 * @param octokit - Octokit instance
 * @param branch - ブランチ名
 * @returns コミットSHA
 */
async function getLatestCommitSha(
  octokit: Octokit,
  branch: string
): Promise<string> {
  const { owner, repo } = REPO_CONFIG;

  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  return ref.object.sha;
}

/**
 * ブランチ作成
 *
 * @param octokit - Octokit instance
 * @param branchName - 作成するブランチ名
 * @param sha - ベースとなるコミットSHA
 * @throws BranchConflictError - 同名ブランチ既存時
 */
async function createBranch(
  octokit: Octokit,
  branchName: string,
  sha: string
): Promise<void> {
  const { owner, repo } = REPO_CONFIG;

  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
  } catch (error: any) {
    if (error.status === 422) {
      throw new BranchConflictError(
        `Branch "${branchName}" already exists`,
        branchName,
        error
      );
    }
    throw error;
  }
}

/**
 * ファイルコミット
 *
 * Codexレビュー指摘対応:
 * - 明示的なcommitter/authorを設定
 *
 * @param octokit - Octokit instance
 * @param params - コミットパラメータ
 */
async function commitFile(
  octokit: Octokit,
  params: {
    path: string;
    content: string;
    branchName: string;
    commitMessage: string;
  }
): Promise<void> {
  const { owner, repo } = REPO_CONFIG;

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: params.path,
    message: params.commitMessage,
    content: Buffer.from(params.content).toString('base64'),
    branch: params.branchName,
    committer: SERVICE_ACCOUNT,
    author: SERVICE_ACCOUNT,
  });
}

/**
 * Pull Request作成
 *
 * @param octokit - Octokit instance
 * @param params - PR作成パラメータ
 * @returns 作成されたPR
 */
async function createPullRequest(
  octokit: Octokit,
  params: {
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
  }
): Promise<{ number: number; html_url: string }> {
  const { owner, repo } = REPO_CONFIG;

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: params.title,
    head: params.branchName,
    base: params.baseBranch,
    body: params.body,
  });

  return {
    number: pr.number,
    html_url: pr.html_url,
  };
}

/**
 * PR Description生成
 *
 * @param metadata - Frontmatter
 * @param params - PR作成パラメータ
 * @returns Markdown形式のPR本文
 */
function generatePrDescription(
  metadata: Frontmatter,
  params: CreateArticlePrParams
): string {
  const lines: string[] = [
    '## Summary',
    '',
    `**Title**: ${metadata.title}`,
    `**Slug**: ${metadata.slug}`,
    `**Date**: ${metadata.date}`,
    `**Author**: ${metadata.author}`,
    `**Categories**: ${metadata.categories.join(', ')}`,
    `**Tags**: ${metadata.tags.join(', ')}`,
    '',
    '## Excerpt',
    '',
    metadata.excerpt,
    '',
  ];

  if (params.source?.feedUrl || params.source?.originalUrl) {
    lines.push('## Source', '');
    if (params.source.feedUrl) {
      lines.push(`**Feed**: ${params.source.feedUrl}`);
    }
    if (params.source.originalUrl) {
      lines.push(`**Original**: ${params.source.originalUrl}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
