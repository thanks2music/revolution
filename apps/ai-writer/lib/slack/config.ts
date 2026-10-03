/**
 * Slack 通知の設定を環境変数から組み立てる
 *
 * 送信先とメンションは**実行環境ごとの env で決める**。キー名は環境で変えない
 * (`.env.sample` の方針と同じ)。
 *
 * | 実行環境 | SLACK_CHANNEL_ID | SLACK_MENTION_USER_ID |
 * |---|---|---|
 * | ローカル実走 | 開発系チャンネル | 設定しない (しても無視) |
 * | Cloud Run | 本番系チャンネル | BOSS のユーザー ID |
 *
 * @module lib/slack/config
 */

export type SlackRuntime = 'cloud-run' | 'local';

export interface SlackConfig {
  token: string;
  channel: string;
  runtime: SlackRuntime;
  /** 失敗時にメンションするユーザー ID。Cloud Run 以外では常に undefined */
  mentionUserId?: string;
}

/**
 * 値が「設定されている」とみなせるか。
 *
 * `op://` で始まる値は 1Password の参照のまま `op run` を通さずに起動した状態。
 * それを token として送ると必ず `invalid_auth` になるうえ、参照パスが
 * エラーログに出るため、未設定と同じ扱いにする。
 */
function presentValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('op://')) return undefined;
  return trimmed;
}

/**
 * env から Slack の設定を読む。token か channel が欠けていれば null (= 通知しない)。
 *
 * 実行環境は Cloud Run が自動で入れる `K_SERVICE` で判定する。`NODE_ENV` は
 * ローカルの `next start` / `docker:run` でも production になるため使わない。
 * **メンションは Cloud Run の時だけ**付ける (env をローカルへコピーしても
 * ローカル実走でメンションが飛ばないようにするためのガード)。
 */
export function readSlackConfig(env: NodeJS.ProcessEnv = process.env): SlackConfig | null {
  const token = presentValue(env.SLACK_BOT_TOKEN);
  const channel = presentValue(env.SLACK_CHANNEL_ID);
  if (!token || !channel) return null;

  const runtime: SlackRuntime = presentValue(env.K_SERVICE) ? 'cloud-run' : 'local';
  const mentionUserId =
    runtime === 'cloud-run' ? presentValue(env.SLACK_MENTION_USER_ID) : undefined;

  return { token, channel, runtime, mentionUserId };
}

/** 送信に必須のキー */
const REQUIRED_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'] as const;

/**
 * 欠けている必須キーの名前を返す (`op://` の参照のままの値も欠けている扱い)。
 * 片方だけ設定されている状態はほぼ確実に設定ミスなので、ログで名指しする
 */
export function missingSlackConfigKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_KEYS.filter(key => !presentValue(env[key]));
}

/** Cloud Run 上で動いているか (`K_SERVICE` は Cloud Run が自動で設定する) */
export function isCloudRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return presentValue(env.K_SERVICE) !== undefined;
}
