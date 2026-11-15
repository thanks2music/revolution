/**
 * 環境変数から GitHub の PAT を選ぶ (純粋関数)。
 *
 * client.ts は ESM の octokit を読み込むため、テストしやすいように分けている。
 */

/** 環境変数で PAT を渡す時の名前。前にあるものほど優先する */
export const PAT_ENV_NAMES = ['REVO_GITHUB_PAT', 'GITHUB_PAT'] as const;

/**
 * 環境変数から PAT を選ぶ。
 *
 * `REVO_GITHUB_PAT` を先に見る。`GITHUB_PAT` は汎用の名前で、シェル全体に export された
 * 別の用途のトークン (期限切れのものを含む) が入っていることがあり、それが Revolution の
 * トークンより先に使われて認証に失敗していたため。
 * `op://` で始まる値は `op run` を通さずに起動した時の参照のままの値なので、未設定と同じ扱いにする。
 */
export function resolveEnvPat(
  env: Record<string, string | undefined>
): { name: (typeof PAT_ENV_NAMES)[number]; value: string } | null {
  for (const name of PAT_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value && !value.startsWith('op://')) return { name, value };
  }
  return null;
}
