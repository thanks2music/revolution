/**
 * GitHub API クライアント
 *
 * Codexレビュー指摘対応:
 * - PAT memoization (1時間TTL)
 * - @octokit/plugin-retry と @octokit/plugin-throttling の統合
 * - カスタム userAgent 設定
 * - request timeout 設定 (10秒)
 */

import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { GitHubAuthError, GitHubNetworkError } from '../errors/github';

/**
 * Octokit with plugins
 */
const MyOctokit = Octokit.plugin(retry, throttling);

/**
 * リポジトリ設定（環境変数から取得）
 */
export const REPO_CONFIG = {
  owner: process.env.GITHUB_OWNER || 'thanks2music', // GitHub organization/user
  repo: process.env.GITHUB_REPO || 'revolution', // Repository name
  baseBranch: process.env.GITHUB_BASE_BRANCH || 'main', // Default branch
  articlesPath: process.env.GITHUB_ARTICLES_PATH || 'content/articles', // MDX files directory
} as const;

/**
 * PAT キャッシュ
 */
let cachedPat: string | null = null;
let patCachedAt: number | null = null;

/**
 * PAT キャッシュのTTL (ミリ秒)
 * Codexレビュー: 1時間キャッシュ、Cloud Run再デプロイで確実にリフレッシュ
 */
const PAT_CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

/**
 * Secret ManagerからGitHub PATを取得 (メモ化)
 *
 * Codexレビュー指摘対応:
 * - プロセス単位でメモ化
 * - TTLベースの自動リフレッシュ
 * - 強制リフレッシュフック提供
 *
 * @param forceRefresh - キャッシュを無視して強制取得
 * @returns GitHub Personal Access Token
 * @throws GitHubAuthError - PAT取得失敗時
 */
async function getGitHubPat(forceRefresh = false): Promise<string> {
  const now = Date.now();

  // キャッシュが有効な場合はそれを返す
  if (
    !forceRefresh &&
    cachedPat &&
    patCachedAt &&
    now - patCachedAt < PAT_CACHE_TTL_MS
  ) {
    return cachedPat;
  }

  try {
    const client = new SecretManagerServiceClient();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 't4v-revo-prd';
    const secretName = `projects/${projectId}/secrets/GITHUB_PAT/versions/latest`;

    const [version] = await client.accessSecretVersion({ name: secretName });
    const pat = version.payload?.data?.toString();

    if (!pat) {
      throw new GitHubAuthError('GitHub PAT is empty in Secret Manager');
    }

    // キャッシュ更新
    cachedPat = pat;
    patCachedAt = now;

    return pat;
  } catch (error) {
    throw new GitHubAuthError(
      'Failed to retrieve GitHub PAT from Secret Manager',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * PAT キャッシュをクリア (テスト用・強制リフレッシュ用)
 */
export function clearPatCache(): void {
  cachedPat = null;
  patCachedAt = null;
}

/**
 * Octokit クライアント作成
 *
 * Codexレビュー指摘対応:
 * - retry/throttling plugins 統合
 * - Retry-After header 尊重
 * - カスタム userAgent 設定
 * - request timeout: 10秒
 *
 * @param forceRefreshPat - PAT強制リフレッシュ
 * @returns Octokit instance
 * @throws GitHubAuthError - PAT取得失敗時
 */
export async function createGitHubClient(
  forceRefreshPat = false
): Promise<InstanceType<typeof MyOctokit>> {
  const auth = await getGitHubPat(forceRefreshPat);

  const octokit = new MyOctokit({
    auth,
    userAgent: 'revo-ai-writer/1.0',
    request: {
      timeout: 10_000, // 10秒
    },
    // retry plugin設定
    retry: {
      // Retry-After ヘッダーを尊重
      doNotRetry: [400, 401, 403, 404, 422], // Client errors (except 429)
      // 429 (Rate Limit) は自動リトライ
    },
    // throttling plugin設定
    throttle: {
      onRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
        octokit.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        // 最大3回までリトライ
        if (retryCount < 3) {
          octokit.log.info(`Retrying after ${retryAfter} seconds (retry ${retryCount + 1}/3)`);
          return true;
        }

        return false;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
        octokit.log.warn(
          `Secondary rate limit detected for request ${options.method} ${options.url}`
        );

        // Abuse detection の場合も最大3回までリトライ
        if (retryCount < 3) {
          octokit.log.info(
            `Retrying after ${retryAfter} seconds (secondary limit, retry ${retryCount + 1}/3)`
          );
          return true;
        }

        return false;
      },
    },
  });

  return octokit;
}

/**
 * ネットワークエラーのラップ
 *
 * Octokit の RequestError を GitHubNetworkError に変換
 *
 * @param error - 元のエラー
 * @throws GitHubNetworkError
 */
export function wrapNetworkError(error: unknown): never {
  if (error instanceof Error) {
    throw new GitHubNetworkError(
      `GitHub API network error: ${error.message}`,
      error
    );
  }
  throw new GitHubNetworkError('Unknown GitHub API network error');
}
