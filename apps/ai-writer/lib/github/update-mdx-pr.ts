/**
 * 公開中の記事の更新 (`pnpm debug:mdx --update <post_id>`) の GitHub 側。
 *
 * - `fetchArticleFromMain`: main の記事を post_id で探し、中身と blob の sha を読む
 * - `createUpdateMdxPr`: 新しいブランチで、その sha を指定して記事を上書きし、PR を作る
 *
 * 新規の記事の PR (`create-mdx-pr.ts`) と違い、Firestore には触れない (記事は登録済みで `generated` のまま)。
 * sha を指定するので、読んだ後に main の記事が変わっていれば GitHub が 409 で拒否する (上書きしない)。
 *
 * Slack 通知はここでは送らない (入口の `scripts/debug-mdx-url.ts` が 1 実行につき 1 通送る)。
 */
import { createGitHubClient, REPO_CONFIG, SERVICE_ACCOUNT_COMMITTER, wrapNetworkError } from './client';
import { GitHubAuthError, BranchConflictError } from '../errors/github';
import { MDX_DEFAULTS } from '../mdx/types';
import type { CreateMdxPrResult } from './create-mdx-pr';

/** main にある記事 */
export interface ArticleOnMain {
  /** リポジトリのルートからのパス (例: apps/ai-writer/content/collabo-cafe/my-hero-academia/01m4s065g1hchh9d.mdx) */
  path: string;
  /** blob の sha (上書きに使う) */
  sha: string;
  content: string;
}

/** post_id は ULID の小文字 (パスの一部になるので、それ以外の文字を通さない) */
const POST_ID = /^[0-9a-z]{10,26}$/;

function isAuthError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

/**
 * main の記事を post_id で探して読む。
 *
 * @throws 記事が無い、または同じ post_id の記事が 2 つ以上あるとき
 */
export async function fetchArticleFromMain(postId: string): Promise<ArticleOnMain> {
  if (!POST_ID.test(postId)) {
    throw new Error(`post_id の形が正しくありません: ${postId}`);
  }

  const octokit = await createGitHubClient();
  const { owner, repo, baseBranch } = REPO_CONFIG;
  const contentDir = MDX_DEFAULTS.CONTENT_BASE_DIR;

  try {
    // 記事のフォルダの木を 1 回で読む (event_type / work_slug は post_id からは分からない)
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: `${baseBranch}:${contentDir}`,
      recursive: 'true',
    });
    if (tree.truncated) {
      throw new Error(`${contentDir} の一覧が GitHub の上限で切り詰められました (記事を探せません)`);
    }

    const matches = tree.tree.filter(
      (entry) => entry.type === 'blob' && entry.path?.split('/').pop() === `${postId}.mdx`,
    );
    if (matches.length === 0) {
      throw new Error(`main に post_id ${postId} の記事がありません (${contentDir})`);
    }
    if (matches.length > 1) {
      throw new Error(
        `main に post_id ${postId} の記事が ${matches.length} つあります: ${matches.map((m) => m.path).join(', ')}`,
      );
    }

    const path = `${contentDir}/${matches[0].path}`;
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: baseBranch });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
      throw new Error(`${path} はファイルではありません`);
    }

    return {
      path,
      sha: data.sha,
      content: Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8'),
    };
  } catch (error) {
    if (isAuthError(error)) {
      throw new GitHubAuthError('GitHub authentication failed', error instanceof Error ? error : undefined);
    }
    throw error;
  }
}

export interface CreateUpdateMdxPrParams {
  mdxContent: string;
  /** 上書きする記事のパス (`fetchArticleFromMain` の path) */
  filePath: string;
  /** 読んだときの blob の sha */
  sha: string;
  title: string;
  body: string;
  branchName: string;
  commitMessage: string;
}

/**
 * 新しいブランチで記事を上書きし、PR を作る。
 *
 * @throws {BranchConflictError} 同じ名前のブランチがあるとき
 * @throws 読んだ後に main の記事が変わっていたとき (409。上書きしない)
 */
export async function createUpdateMdxPr(params: CreateUpdateMdxPrParams): Promise<CreateMdxPrResult> {
  const { mdxContent, filePath, sha, title, body, branchName, commitMessage } = params;
  const { owner, repo, baseBranch } = REPO_CONFIG;

  console.log('[Update MDX PR] 記事の更新の PR を作ります');
  console.log(`  Branch: ${branchName}`);
  console.log(`  File: ${filePath}`);

  // ブランチを作った後に失敗したら、ブランチが残っていることを知らせる (片付けは人が行う)
  let branchCreated = false;
  try {
    const octokit = await createGitHubClient();

    const { data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });

    try {
      await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: baseRef.object.sha });
      branchCreated = true;
    } catch (error) {
      const e = error as { status?: number; message?: string };
      if (e.status === 422 && e.message?.includes('Reference already exists')) {
        throw new BranchConflictError(`Branch already exists: ${branchName}`, branchName);
      }
      throw error;
    }

    let commitSha: string;
    try {
      const { data: commitData } = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(mdxContent, 'utf-8').toString('base64'),
        sha,
        branch: branchName,
        committer: SERVICE_ACCOUNT_COMMITTER,
        author: SERVICE_ACCOUNT_COMMITTER,
      });
      commitSha = commitData.commit.sha!;
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        throw new Error(
          `記事を読んだ後に main の ${filePath} が変わりました (上書きしません)。もう一度実行してください`,
        );
      }
      throw error;
    }

    const { data: pr } = await octokit.pulls.create({ owner, repo, title, body, head: branchName, base: baseBranch });
    console.log(`  ✅ PR created: ${pr.html_url}`);

    return { prNumber: pr.number, prUrl: pr.html_url, branchName, commitSha };
  } catch (error) {
    console.error('[Update MDX PR] ❌ 記事の更新の PR を作れませんでした:', error);
    if (branchCreated) {
      console.error(`[Update MDX PR] ブランチ ${branchName} が残っています (不要なら削除してください)`);
    }
    if (isAuthError(error)) {
      throw new GitHubAuthError('GitHub authentication failed', error instanceof Error ? error : undefined);
    }
    if (error instanceof BranchConflictError || !(error as { status?: number }).status) {
      // こちらで作ったエラー (409 の説明・ブランチの衝突) はそのまま投げる
      throw error;
    }
    wrapNetworkError(error);
  }
}
