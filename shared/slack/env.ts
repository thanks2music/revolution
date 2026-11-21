/**
 * Slack の設定を env から読む時の部品。
 *
 * @module @revolution/slack/env
 */

/**
 * 値が「設定されている」とみなせれば、前後の空白を除いて返す。そうでなければ undefined。
 *
 * `op://` で始まる値は、1Password の参照のまま `op run` を通さずに起動した状態。
 * それを token として送ると必ず `invalid_auth` になるうえ、参照のパスがエラーログに出るため、
 * 未設定と同じ扱いにする。
 */
export function presentEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('op://')) return undefined;
  return trimmed;
}
