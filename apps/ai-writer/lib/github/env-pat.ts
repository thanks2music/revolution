/**
 * 環境変数から GitHub の PAT を選ぶ (純粋関数)。
 *
 * client.ts は ESM の octokit を読み込むため、テストしやすいように分けている。
 */

/** 環境変数で PAT を渡す時の名前。前にあるものほど優先する */
export const PAT_ENV_NAMES = ['REVO_GITHUB_PAT', 'GITHUB_PAT'] as const;

type PatEnvName = (typeof PAT_ENV_NAMES)[number];

/** 1Password の参照の接頭辞。`op run` が実行時に値へ置き換える */
const ONE_PASSWORD_REF_PREFIX = 'op://';

export type EnvPatResolution =
  /** この名前の値を使う */
  | { kind: 'pat'; name: PatEnvName; value: string }
  /** この名前が `op://` の参照のまま (`op run` を通さずに起動した)。次の名前へは進まない */
  | { kind: 'unresolved-ref'; name: PatEnvName }
  /** どの名前にも値が無い (Secret Manager を使う) */
  | { kind: 'none' };

/**
 * 環境変数から PAT を選ぶ。
 *
 * `REVO_GITHUB_PAT` を先に見る。`GITHUB_PAT` は汎用の名前で、シェル全体に export された
 * 別の用途のトークン (期限切れのものを含む) が入っていることがあり、それが Revolution の
 * トークンより先に使われて認証に失敗していたため。
 *
 * 値が `op://` の参照のままなら、その名前で止める。次の名前へ進むと、意図したトークンの代わりに
 * シェルの古い `GITHUB_PAT` を使い、同じ 401 が別の経路で起きるため。呼び出し側が分かるエラーにする。
 * 空 (空白だけを含む) の値は未設定として次の名前へ進む。
 */
export function resolveEnvPat(env: Record<string, string | undefined>): EnvPatResolution {
  for (const name of PAT_ENV_NAMES) {
    // 前後の空白を落としてから判定する (' op://...' も参照として扱うため)
    const value = env[name]?.trim();
    if (!value) continue;
    if (value.startsWith(ONE_PASSWORD_REF_PREFIX)) return { kind: 'unresolved-ref', name };
    return { kind: 'pat', name, value };
  }
  return { kind: 'none' };
}
