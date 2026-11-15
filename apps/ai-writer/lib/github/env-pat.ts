/**
 * 環境変数から GitHub の PAT を選ぶ (純粋関数)。
 *
 * client.ts は ESM の octokit を読み込むため、テストしやすいように分けている。
 */

/** 環境変数で PAT を渡す時の名前。前にあるものほど優先する */
export const PAT_ENV_NAMES = ['REVO_GITHUB_PAT', 'GITHUB_PAT'] as const;

type PatEnvName = (typeof PAT_ENV_NAMES)[number];

export interface EnvPatResolution {
  /** 使う PAT。どの名前にも値が無ければ null (Secret Manager を使う) */
  pat: { name: PatEnvName; value: string } | null;
  /** `op://` の参照のままだったため飛ばした名前 (`op run` を通さずに起動した時) */
  unresolvedRefs: PatEnvName[];
}

/**
 * 環境変数から PAT を選ぶ。
 *
 * `REVO_GITHUB_PAT` を先に見る。`GITHUB_PAT` は汎用の名前で、シェル全体に export された
 * 別の用途のトークン (期限切れのものを含む) が入っていることがあり、それが Revolution の
 * トークンより先に使われて認証に失敗していたため。
 * `op://` で始まる値は `op run` を通さずに起動した時の参照のままの値なので、未設定と同じ扱いにし、
 * 呼び出し側が警告できるように `unresolvedRefs` に名前を残す。
 */
export function resolveEnvPat(env: Record<string, string | undefined>): EnvPatResolution {
  const unresolvedRefs: PatEnvName[] = [];
  for (const name of PAT_ENV_NAMES) {
    // 前後の空白を落としてから判定する (' op://...' も参照として扱うため)
    const value = env[name]?.trim();
    if (!value) continue;
    if (value.startsWith('op://')) {
      unresolvedRefs.push(name);
      continue;
    }
    return { pat: { name, value }, unresolvedRefs };
  }
  return { pat: null, unresolvedRefs };
}
