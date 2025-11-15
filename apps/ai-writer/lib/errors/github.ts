/**
 * GitHub API関連のカスタムエラー定義
 *
 * Codexレビュー指摘対応:
 * - status と retryable フィールドを追加
 * - Cron routeでの5xx/4xx判定に使用
 */

/**
 * GitHub APIエラーの基底クラス
 */
export abstract class GitHubError extends Error {
  abstract readonly status: number;
  abstract readonly retryable: boolean;

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;

    // Stack trace の保持
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * GitHub API Rate Limit エラー
 *
 * 発生条件:
 * - 403 with x-ratelimit-remaining=0
 * - 429 (abuse detection)
 *
 * 対応:
 * - Retry-After ヘッダーを尊重
 * - Exponential backoff適用
 */
export class GitHubRateLimitError extends GitHubError {
  readonly status = 429;
  readonly retryable = true;

  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Slug重複エラー
 *
 * 発生条件:
 * - 同じslugの記事が既にcontent/articles/に存在
 *
 * 対応:
 * - リトライ不可（4xx）
 * - ログに記録してスキップ
 */
export class DuplicateSlugError extends GitHubError {
  readonly status = 409;
  readonly retryable = false;

  constructor(
    message: string,
    public readonly slug: string,
    public readonly existingFilePath: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * ブランチ作成の競合エラー
 *
 * 発生条件:
 * - 同じブランチ名が既に存在
 * - Base branchが移動してSHAが古い
 *
 * 対応:
 * - リトライ可能（新しいtimestamp付きブランチ名で再試行）
 */
export class BranchConflictError extends GitHubError {
  readonly status = 422;
  readonly retryable = true;

  constructor(
    message: string,
    public readonly branchName: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * GitHub認証エラー
 *
 * 発生条件:
 * - 無効なPAT
 * - PATの権限不足
 *
 * 対応:
 * - リトライ不可（4xx）
 * - Secret Managerの設定確認必要
 */
export class GitHubAuthError extends GitHubError {
  readonly status = 401;
  readonly retryable = false;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * GitHub API通信エラー
 *
 * 発生条件:
 * - ネットワークタイムアウト
 * - DNS解決失敗
 * - 接続エラー
 *
 * 対応:
 * - リトライ可能（5xx相当）
 */
export class GitHubNetworkError extends GitHubError {
  readonly status = 503;
  readonly retryable = true;

  constructor(message: string, cause?: Error) {
    super(message, cause);
  }
}

/**
 * エラーがリトライ可能かチェックするヘルパー関数
 */
export function isRetryableGitHubError(error: unknown): boolean {
  if (error instanceof GitHubError) {
    return error.retryable;
  }
  return false;
}

/**
 * エラーからHTTPステータスコードを取得するヘルパー関数
 */
export function getGitHubErrorStatus(error: unknown): number {
  if (error instanceof GitHubError) {
    return error.status;
  }
  // 不明なエラーは500として扱う
  return 500;
}
