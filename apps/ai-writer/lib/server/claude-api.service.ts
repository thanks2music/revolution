import 'server-only';
import { cache } from 'react';
import { ClaudeAPIService } from '../services/claude-api.service';

/**
 * Server-only Claude API service instance getter
 *
 * This module is marked as 'server-only' to ensure it never gets bundled into the client.
 * The service is wrapped with React's cache() to provide request-scoped memoization.
 *
 * 認証は `createAnthropicClient` が決める (Cloud Run は ID フェデレーション、ローカルは
 * `ant auth login` のプロファイル)。資格情報の解決は最初のリクエストの時なので、
 * 秘密の無いビルドの最中に作っても失敗しない。
 *
 * @returns ClaudeAPIService instance
 */
export const getClaudeService = cache((): ClaudeAPIService => new ClaudeAPIService());
