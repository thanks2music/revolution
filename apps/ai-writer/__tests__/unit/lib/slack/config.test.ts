/**
 * Layer 1: Slack 設定の読み取り (env → SlackConfig)
 *
 * 固定したい性質:
 * - token / channel のどちらかが欠けたら null (= 通知しない)
 * - `op://` の参照のままの値は未設定扱い (op run を通さずに起動した状態)
 * - メンションは Cloud Run (`K_SERVICE` あり) の時だけ。ローカル実走では絶対に鳴らさない
 */
import { describe, expect, it } from '@jest/globals';

import { readSlackConfig } from '@/lib/slack/config';

const BASE = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_CHANNEL_ID: 'C0000000001',
} as NodeJS.ProcessEnv;

describe('readSlackConfig', () => {
  it('token と channel があればローカル実行として設定を返す', () => {
    expect(readSlackConfig(BASE)).toEqual({
      token: 'xoxb-test-token',
      channel: 'C0000000001',
      runtime: 'local',
      mentionUserId: undefined,
    });
  });

  it.each([
    ['token が未設定', { ...BASE, SLACK_BOT_TOKEN: undefined }],
    ['token が空文字', { ...BASE, SLACK_BOT_TOKEN: '' }],
    ['token が空白のみ', { ...BASE, SLACK_BOT_TOKEN: '   ' }],
    ['channel が未設定', { ...BASE, SLACK_CHANNEL_ID: undefined }],
  ])('%s なら null', (_label, env) => {
    expect(readSlackConfig(env as NodeJS.ProcessEnv)).toBeNull();
  });

  // op run を通さずに起動すると、参照文字列がそのまま入ってくる。
  // それを token として送ると invalid_auth になり、参照パスもログに出る
  it('token が op:// の参照のままなら null', () => {
    expect(readSlackConfig({ ...BASE, SLACK_BOT_TOKEN: 'op://Personal/slack/token' })).toBeNull();
  });

  it('K_SERVICE があれば Cloud Run として扱い、メンション ID を返す', () => {
    const config = readSlackConfig({
      ...BASE,
      K_SERVICE: 'revo-ai-writer',
      SLACK_MENTION_USER_ID: 'U0000000001',
    });

    expect(config?.runtime).toBe('cloud-run');
    expect(config?.mentionUserId).toBe('U0000000001');
  });

  // ★ env をローカルへコピーしても、ローカル実走でメンションが飛ばないためのガード
  it('ローカル実行ではメンション ID が設定されていても無視する', () => {
    const config = readSlackConfig({ ...BASE, SLACK_MENTION_USER_ID: 'U0000000001' });

    expect(config?.runtime).toBe('local');
    expect(config?.mentionUserId).toBeUndefined();
  });

  it('前後の空白は取り除く', () => {
    const config = readSlackConfig({
      SLACK_BOT_TOKEN: '  xoxb-test-token \n',
      SLACK_CHANNEL_ID: ' C0000000001 ',
    } as NodeJS.ProcessEnv);

    expect(config?.token).toBe('xoxb-test-token');
    expect(config?.channel).toBe('C0000000001');
  });
});
