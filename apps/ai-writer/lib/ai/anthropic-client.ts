/**
 * @fileoverview Anthropic のクライアントを作る唯一の場所 (Layer 2 の境界)
 *
 * Cloud Run では静的な API キーを使わない (2026-10-11 決定)。
 *
 * - **Cloud Run**: Workload Identity Federation。メタデータサーバーが発行する Google の ID トークンを
 *   Anthropic の短命のトークンに交換する。サービスアカウント・ルールなどの ID は環境変数で受け取る
 *   (deploy の workflow が GitHub の Variables から渡す)
 * - **ローカル (主な使い方)**: `ant auth login` のプロファイル (`~/.config/anthropic-revolution` の `revolution`)。
 *   Claude Code が既定の `~/.config/anthropic` を読むため、専用のディレクトリに分けている
 * - **ローカル (逃げ道)**: `AI_WRITER_ANTHROPIC_API_KEY` が空でなければ、その API キーを使う。
 *   Gemini / ChatGPT と同じく、キーだけで手早くデバッグするため。`ANTHROPIC_API_KEY` を読まないのは、
 *   Claude Code やシェルが空の値や別の組織のキーを入れていることがあり、それを拾わないため
 *
 * @see https://platform.claude.com/docs/en/manage-claude/workload-identity-federation
 * @see https://platform.claude.com/docs/en/manage-claude/wif-providers/gcp
 */

import os from 'node:os';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';

import { isCloudRun } from '@/lib/utils/cloud-run';

/** Google の ID トークンに載せる audience。フェデレーションのルールで同じ値に固定している */
const ANTHROPIC_AUDIENCE = 'https://api.anthropic.com';

/**
 * Cloud Run のメタデータサーバーで ID トークンを取る URL。
 * `format=full` にしないと `email` の claim が載らず、ルールの `email` の一致条件で拒否される。
 */
export const GOOGLE_IDENTITY_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
  `?audience=${encodeURIComponent(ANTHROPIC_AUDIENCE)}&format=full`;

/** ローカルで使う `ant auth login` のプロファイル */
const LOCAL_PROFILE = 'revolution';

/** ローカルのプロファイルを置く設定ディレクトリ (`ANTHROPIC_CONFIG_DIR` が未設定のとき) */
export function defaultLocalConfigDir(): string {
  return path.join(os.homedir(), '.config', 'anthropic-revolution');
}

type Env = Record<string, string | undefined>;

/** ローカルの逃げ道で使う API キーの環境変数 */
const LOCAL_API_KEY_ENV = 'AI_WRITER_ANTHROPIC_API_KEY';

/** Cloud Run でフェデレーションに要る環境変数 (`ANTHROPIC_WORKSPACE_ID` はルールが 1 つのワークスペースに限られるため任意) */
const FEDERATION_ENV_KEYS = [
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_SERVICE_ACCOUNT_ID',
] as const;

export type AnthropicAuth =
  | {
      mode: 'federation';
      federationRuleId: string;
      organizationId: string;
      serviceAccountId: string;
      workspaceId?: string;
    }
  | { mode: 'profile'; profile: string; configDir: string }
  | { mode: 'api-key'; apiKey: string };

/**
 * どの方法で認証するかを決める (Layer 1)。
 *
 * Cloud Run ではフェデレーションの変数が揃っていなければ失敗にする。
 * API キーへ黙って戻ると、キーを外した切り替えの漏れに気づけないため。
 * 同じ理由で、Cloud Run に `AI_WRITER_ANTHROPIC_API_KEY` があれば無視せずに失敗にする。
 * Cloud Run の判定は、Service が持つ `K_SERVICE` と、Jobs が持つ `CLOUD_RUN_JOB` のどちらか。
 *
 * ローカルでは `AI_WRITER_ANTHROPIC_API_KEY` が空でなければ API キー、それ以外はプロファイル。
 *
 * @throws {Error} Cloud Run でフェデレーションの環境変数が欠けているとき、または API キーが設定されているとき
 */
export function resolveAnthropicAuth(env: Env): AnthropicAuth {
  const apiKey = env[LOCAL_API_KEY_ENV]?.trim();

  if (isCloudRun(env)) {
    if (apiKey) {
      throw new Error(
        `[anthropic-client] ${LOCAL_API_KEY_ENV} is for local debugging only and must not be set on Cloud Run`
      );
    }
    const missing = FEDERATION_ENV_KEYS.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `[anthropic-client] Workload Identity Federation is not configured on Cloud Run: missing ${missing.join(', ')}`
      );
    }
    return {
      mode: 'federation',
      federationRuleId: env.ANTHROPIC_FEDERATION_RULE_ID!,
      organizationId: env.ANTHROPIC_ORGANIZATION_ID!,
      serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID!,
      workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
    };
  }

  if (apiKey) {
    return { mode: 'api-key', apiKey };
  }

  return {
    mode: 'profile',
    profile: env.ANTHROPIC_PROFILE || LOCAL_PROFILE,
    configDir: env.ANTHROPIC_CONFIG_DIR || defaultLocalConfigDir(),
  };
}

/** メタデータサーバーを待つ上限。応答が詰まったとき、Claude の呼び出しが無期限に待たないようにする */
const METADATA_TIMEOUT_MS = 5_000;

/**
 * Cloud Run のメタデータサーバーから Google の ID トークンを取る。
 * ID トークンは毎回新しく取る (Anthropic は jti の再利用を拒否するため、キャッシュしない)。
 *
 * @throws {Error} HTTP エラー、時間切れ、空の応答のとき
 */
export async function fetchGoogleIdentityToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(GOOGLE_IDENTITY_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[anthropic-client] Failed to fetch a Google identity token: HTTP ${response.status}`);
  }
  const token = (await response.text()).trim();
  if (!token) {
    throw new Error('[anthropic-client] The metadata server returned an empty identity token');
  }
  return token;
}

let cachedClient: { key: string; client: Anthropic } | undefined;

/**
 * Anthropic のクライアントを返す。全ての Claude の呼び出しはこれを使う。
 *
 * クライアントはプロセスで 1 つを共有する (認証の設定が同じ間)。SDK はトークンを
 * クライアントごとに持つため、1 回のパイプラインで 10 近く作ると、トークンの交換
 * (Cloud Run) やプロファイルの読み込み (ローカル) も同じ回数だけ起きる。
 *
 * ローカルでは `profile` を明示する。SDK の仕様で、明示した `profile` は環境変数の
 * `ANTHROPIC_API_KEY` より優先される (Claude Code の中では空の `ANTHROPIC_API_KEY` が
 * 入っていることがあり、それに負けないため)。設定ディレクトリは SDK が
 * `ANTHROPIC_CONFIG_DIR` から読むので、未設定のときだけ既定値を入れる。
 *
 * クライアントを作るたびに、どの認証で動くかを 1 行ログに出す (`[anthropic-client] auth: <mode>`)。
 *
 * @param env - 既定は `process.env` (ローカルでは `ANTHROPIC_CONFIG_DIR` を補うため書き込む)
 */
export function createAnthropicClient(env: Env = process.env): Anthropic {
  const auth = resolveAnthropicAuth(env);

  // 空文字も未設定として扱う (SDK も空文字なら既定の ~/.config/anthropic を読むため)
  if (auth.mode === 'profile' && !env.ANTHROPIC_CONFIG_DIR) {
    env.ANTHROPIC_CONFIG_DIR = auth.configDir;
  }

  const key = JSON.stringify(auth);
  if (cachedClient?.key !== key) {
    // どの方法で動いたかを残す (キーの値は出さない)
    console.info(`[anthropic-client] auth: ${auth.mode}`);
    cachedClient = { key, client: buildClient(auth) };
  }
  return cachedClient.client;
}

function buildClient(auth: AnthropicAuth): Anthropic {
  switch (auth.mode) {
    case 'federation':
      return new Anthropic({
        credentials: oidcFederationProvider({
          identityTokenProvider: () => fetchGoogleIdentityToken(),
          federationRuleId: auth.federationRuleId,
          organizationId: auth.organizationId,
          serviceAccountId: auth.serviceAccountId,
          workspaceId: auth.workspaceId,
          baseURL: ANTHROPIC_AUDIENCE,
          fetch,
        }),
      });
    case 'api-key':
      // authToken と baseURL も明示する。未指定だと SDK が環境変数の ANTHROPIC_AUTH_TOKEN /
      // ANTHROPIC_BASE_URL を読み、別の資格情報が混ざったり、キーが別のホストへ送られたりする
      return new Anthropic({ apiKey: auth.apiKey, authToken: null, baseURL: ANTHROPIC_AUDIENCE });
    case 'profile':
      return new Anthropic({ profile: auth.profile });
  }
}
