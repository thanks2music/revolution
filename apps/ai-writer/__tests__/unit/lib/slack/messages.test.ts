/**
 * Layer 1: パイプライン結果 → Slack メッセージの組み立て
 *
 * 固定したい性質:
 * - メンションは「失敗」かつ Cloud Run の時だけ。top-level `text` にも入る
 *   (blocks 使用時、通知に表示されるのは text のため)
 * - 補間値は & < > をエスケープする (`<!channel>` 混入で全員に通知が飛ぶのを防ぐ)
 * - スキップを失敗と取り違えない (戻り値は success: false, skipped: true)
 */
import { describe, expect, it } from '@jest/globals';

import {
  buildPipelineMessage,
  escapeSlackText,
  pipelineNotificationFromResult,
  redactSecrets,
  truncate,
  type PipelineMode,
  type PipelineNotification,
} from '@/lib/slack/messages';

const LOCAL = { runtime: 'local' as const, mentionUserId: undefined };
const CLOUD_RUN = { runtime: 'cloud-run' as const, mentionUserId: 'U0000000001' };

const failure: PipelineNotification = {
  outcome: 'failure',
  entrypoint: 'cron',
  sourceUrl: 'https://example.com/rss',
  error: 'Bad credentials',
};

/** blocks を JSON 文字列にして中身を検査する */
function blocksText(message: { blocks: unknown[] }): string {
  return JSON.stringify(message.blocks);
}

describe('escapeSlackText / truncate', () => {
  it('& < > をエスケープする', () => {
    expect(escapeSlackText('<!channel> a & b')).toBe('&lt;!channel&gt; a &amp; b');
  });

  it('上限を超えたら末尾を … にして上限の長さに収める', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  // UTF-16 単位で切ると絵文字のサロゲートペアが割れ、Slack で文字化けする
  it('絵文字のサロゲートペアを割らない', () => {
    const result = truncate('😀'.repeat(5), 3);

    expect(result).toBe('😀😀…');
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('redactSecrets', () => {
  it.each([
    ['Slack', 'token=xoxb-1234567890-abcdefghij'],
    ['Anthropic', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['GitHub', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['GitHub fine-grained', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
    ['Google', 'AIzaSyA1234567890abcdefghijklmnopqrstu'],
    ['Authorization', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefgh'],
  ])('%s の token を伏せる', (_label, value) => {
    const redacted = redactSecrets(value);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toMatch(/xoxb-1|sk-ant|ghp_a|github_pat_1|AIzaSy|eyJhbGci/);
  });

  // 値はわざと短くしている (gitleaks の検出パターンに当たらないようにするため)
  it.each([
    [
      'PEM 秘密鍵',
      '-----BEGIN PRIVATE KEY-----\nMIIBfakeKeyBody\n-----END PRIVATE KEY-----',
      'MIIBfakeKeyBody',
    ],
    [
      'Slack Incoming Webhook',
      'post to https://hooks.slack.com/services/T0/B0/abcdef failed',
      'hooks.slack.com',
    ],
    ['Slack app-level token', 'xapp-1-A0000000-abcdefgh', 'A0000000'],
    ['JWT', 'apikey eyJhbGciOiJ.eyJyb2xlIjoi.abcdefgh', 'eyJyb2xlIjoi'],
  ])('%s を伏せる', (_label, value, leaked) => {
    const redacted = redactSecrets(value);

    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain(leaked);
  });

  it('token を含まない文はそのまま', () => {
    expect(redactSecrets('Bad credentials (HTTP 401)')).toBe('Bad credentials (HTTP 401)');
  });
});

describe('buildPipelineMessage', () => {
  it('Cloud Run の失敗は text の先頭でメンションし、production と表示する', () => {
    const message = buildPipelineMessage(failure, CLOUD_RUN);

    expect(message.text.startsWith('<@U0000000001> ')).toBe(true);
    expect(message.text).toContain('❌ 失敗');
    expect(message.text).toContain('[production]');
    // block 0 にも同じ文字列 (header は plain_text でメンションできないため section)
    expect(message.blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: message.text },
    });
  });

  it('成功とスキップではメンションしない', () => {
    for (const outcome of ['success', 'skipped'] as const) {
      const message = buildPipelineMessage({ ...failure, outcome }, CLOUD_RUN);
      expect(message.text).not.toContain('<@');
    }
  });

  it('ローカル実行の失敗はメンションせず local と表示する', () => {
    const message = buildPipelineMessage({ ...failure, entrypoint: 'cli' }, LOCAL);

    expect(message.text).not.toContain('<@');
    expect(message.text).toContain('[local]');
  });

  it('エラー文の <!channel> はエスケープされ、生のまま残らない', () => {
    const message = buildPipelineMessage(
      { ...failure, error: 'boom <!channel> & <@U999>' },
      CLOUD_RUN
    );
    const body = blocksText(message);

    expect(body).not.toContain('<!channel>');
    expect(body).not.toContain('<@U999>');
    expect(body).toContain('&lt;!channel&gt;');
  });

  // エラー文以外の補間値もすべてエスケープする (どれか 1 つでも漏れると全員に通知が飛ぶ)
  it.each([
    ['sourceUrl', { sourceUrl: 'https://example.com/<!channel>' }],
    // URL として解釈できない値は、要約の行にホスト名ではなく生の文字列が入る
    ['sourceUrl (URL でない値)', { sourceUrl: '<!channel>' }],
    ['prUrl', { outcome: 'success' as const, prUrl: 'https://example.com/<!channel>' }],
    ['skipReason', { outcome: 'skipped' as const, skipReason: '<!channel>' }],
    // 型の上では起きないが、実行時の値も必ずエスケープを通ることを固定する
    ['mode', { mode: '<!channel>' as PipelineMode }],
    ['workSlug', { workSlug: '<!channel>' }],
    ['postId', { postId: '<!channel>' }],
    ['logPath', { logPath: 'logs/<!channel>.log' }],
    ['revision', { revision: '<!channel>' }],
  ])('%s の <!channel> もエスケープされる', (_field, override) => {
    const message = buildPipelineMessage({ ...failure, ...override }, CLOUD_RUN);
    const whole = JSON.stringify(message);

    expect(whole).not.toContain('<!channel>');
    expect(whole).toContain('&lt;!channel&gt;');
  });

  it('エラー文は 500 字で切り詰める', () => {
    const message = buildPipelineMessage({ ...failure, error: 'x'.repeat(2000) }, LOCAL);
    const detail = message.blocks[2] as { text: { text: string } };

    expect(detail.text.text).toContain(`${'x'.repeat(499)}…`);
    expect(detail.text.text).not.toContain('x'.repeat(500));
  });

  it('エラー文に含まれる token は Slack に載らない', () => {
    const message = buildPipelineMessage(
      { ...failure, error: 'GitHub API failed with ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
      LOCAL
    );

    expect(JSON.stringify(message)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(JSON.stringify(message)).toContain('[REDACTED]');
  });

  // エスケープの後で切ると `&amp;` の途中で切れて `&am…` のように崩れる
  it('切り詰めは entity の途中で切らない', () => {
    const message = buildPipelineMessage({ ...failure, error: `${'x'.repeat(497)}&&&&&&` }, LOCAL);
    const detail = (message.blocks[2] as { text: { text: string } }).text.text;

    expect(detail).not.toMatch(/&[a-z]{0,3}…/);
  });

  it('エラー文の ``` でコードブロックが途中で閉じない', () => {
    const message = buildPipelineMessage({ ...failure, error: 'a ``` b' }, LOCAL);
    const detail = message.blocks[2] as { text: { text: string } };

    // 開始と終了の 2 つだけ
    expect(detail.text.text.match(/```/g)).toHaveLength(2);
  });

  it('成功は PR の URL を載せる', () => {
    const message = buildPipelineMessage(
      {
        ...failure,
        outcome: 'success',
        entrypoint: 'cli',
        prUrl: 'https://github.com/thanks2music/revolution/pull/1',
      },
      LOCAL
    );

    expect(blocksText(message)).toContain('https://github.com/thanks2music/revolution/pull/1');
  });

  // PR を作るモードで URL が無いのは想定外。「作成していません」と出すと気づけない
  it('PR を作るモードで URL が無い成功は、確認を促す', () => {
    const message = buildPipelineMessage(
      { ...failure, outcome: 'success', entrypoint: 'cli', mode: 'pr' },
      LOCAL
    );

    expect(blocksText(message)).toContain('PR の URL を取得できませんでした');
    expect(blocksText(message)).not.toContain('作成していません');
  });

  it('PR を作らないモードの成功はその旨を載せる', () => {
    const message = buildPipelineMessage(
      { ...failure, outcome: 'success', entrypoint: 'cli', mode: 'dry-run' },
      LOCAL
    );

    expect(blocksText(message)).toContain('作成していません');
  });

  it('ログのパスと revision は context に載せる', () => {
    const message = buildPipelineMessage(
      { ...failure, logPath: 'logs/a.log', revision: 'revo-ai-writer-00042' },
      CLOUD_RUN
    );
    const last = message.blocks[message.blocks.length - 1] as { type: string };

    expect(last.type).toBe('context');
    expect(JSON.stringify(last)).toContain('logs/a.log');
    expect(JSON.stringify(last)).toContain('revo-ai-writer-00042');
  });

  it('Block Kit の上限 (50 blocks / fields 10 個) を超えない', () => {
    const message = buildPipelineMessage(
      {
        ...failure,
        mode: 'pr',
        workSlug: 'w',
        postId: 'p',
        logPath: 'l',
        revision: 'r',
      },
      CLOUD_RUN
    );
    const fields = (message.blocks[1] as { fields: unknown[] }).fields;

    expect(message.blocks.length).toBeLessThanOrEqual(50);
    expect(fields.length).toBeLessThanOrEqual(10);
  });

  // 切り詰めはエスケープ前なので、`&` だけの値はエスケープで 5 倍に伸びる。それでも上限に収まること
  it('エスケープで伸びても Block Kit の文字数上限 (fields 2000 / section 3000) を超えない', () => {
    const huge = '&'.repeat(5000);
    const message = buildPipelineMessage(
      {
        outcome: 'failure',
        entrypoint: 'cli',
        sourceUrl: huge,
        mode: huge as PipelineMode,
        workSlug: huge,
        postId: huge,
        logPath: huge,
        revision: huge,
        error: huge,
      },
      CLOUD_RUN
    );

    for (const block of message.blocks as Array<{
      text?: { text: string };
      fields?: Array<{ text: string }>;
      elements?: Array<{ text: string }>;
    }>) {
      if (block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
      for (const field of block.fields ?? []) expect(field.text.length).toBeLessThanOrEqual(2000);
      for (const element of block.elements ?? [])
        expect(element.text.length).toBeLessThanOrEqual(3000);
    }
  });
});

describe('pipelineNotificationFromResult', () => {
  const context = {
    entrypoint: 'cli' as const,
    sourceUrl: 'https://example.com/a',
    mode: 'pr' as const,
  };

  // ★ スキップは success: false で返る。先に skipped を見ないと「失敗」と通知される
  it('skipped: true は success: false でもスキップとして扱う', () => {
    const notification = pipelineNotificationFromResult(
      { success: false, skipped: true, skipReason: '公式 URL なし' },
      context
    );

    expect(notification.outcome).toBe('skipped');
    expect(notification.skipReason).toBe('公式 URL なし');
  });

  it('success: false は失敗としてエラー文を載せる', () => {
    const notification = pipelineNotificationFromResult(
      { success: false, error: 'boom', details: { workSlug: 'w', postId: 'p' } },
      context
    );

    expect(notification).toMatchObject({
      outcome: 'failure',
      error: 'boom',
      workSlug: 'w',
      postId: 'p',
      entrypoint: 'cli',
      sourceUrl: 'https://example.com/a',
      mode: 'pr',
    });
  });

  it('success: true は PR の URL を載せる', () => {
    const notification = pipelineNotificationFromResult(
      { success: true, prResult: { prUrl: 'https://github.com/x/y/pull/2' } },
      context
    );

    expect(notification.outcome).toBe('success');
    expect(notification.prUrl).toBe('https://github.com/x/y/pull/2');
  });
});
