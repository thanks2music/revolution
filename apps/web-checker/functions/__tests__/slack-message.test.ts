import { describe, expect, it } from '@jest/globals';

import { buildErrorMessage, buildNoContentMessage, buildUpdateMessage, historyUrl } from '../src/slack-message';

const target = { title: 'サンプル公式サイト', url: 'https://example.com/news', selector: '#news' };
const siteUrl = 'https://web-checker.example.com';

function texts(message: { blocks?: Array<Record<string, unknown>> }): string {
  return JSON.stringify(message.blocks);
}

describe('historyUrl', () => {
  it('末尾のスラッシュを重ねず、ID をエンコードする', () => {
    expect(historyUrl(`${siteUrl}/`, 'a b')).toBe(`${siteUrl}/detail?targetId=a%20b`);
  });
});

describe('buildUpdateMessage', () => {
  const base = {
    targetId: 'target-1',
    target,
    siteUrl,
    detectedAt: new Date('2026-11-23T03:05:00Z').getTime(),
    content: 'お知らせ A\n',
    diff: '+ お知らせ A\n',
  };

  it('前回があれば「更新が検知されました」で、前回の日時と履歴へのリンクを載せる', () => {
    const message = buildUpdateMessage({ ...base, previousAt: new Date('2026-11-23T02:05:00Z').getTime() });
    expect(message.text).toBe('[サンプル公式サイト] で更新が検知されました');
    expect(texts(message)).toContain('<https://example.com/news|[サンプル公式サイト] で更新が検知されました>');
    expect(texts(message)).toContain('2026/11/23 11:05:00');
    expect(texts(message)).toContain(`<${siteUrl}/detail?targetId=target-1|履歴を見る>`);
  });

  it('前回が無ければ「新規追加されました」で、前回の日時は -', () => {
    const message = buildUpdateMessage(base);
    expect(message.text).toBe('[サンプル公式サイト] が新規追加されました');
    expect(texts(message)).toContain('*前回の更新日時*\\n-');
  });

  it('ページ由来の文字列はエスケープする (<!channel> で全員に通知が飛ばないように)', () => {
    const message = buildUpdateMessage({ ...base, content: '<!channel> & co', diff: '+ <!here>\n' });
    expect(texts(message)).not.toContain('<!channel>');
    expect(texts(message)).not.toContain('<!here>');
    expect(texts(message)).toContain('&lt;!channel&gt; &amp; co');
  });

  it('差分が長ければ切り詰める (section の上限 3000 字を超えない)', () => {
    const message = buildUpdateMessage({ ...base, diff: `+ ${'あ'.repeat(5000)}` });
    for (const block of message.blocks ?? []) {
      const text = (block.text as { text?: string } | undefined)?.text ?? '';
      expect(Array.from(text).length).toBeLessThanOrEqual(3000);
    }
  });

  it('エスケープで字数が増えても、section の上限 3000 字を超えない', async () => {
    const message = buildUpdateMessage({ ...base, diff: `+ ${'&'.repeat(5000)}` });
    for (const block of message.blocks ?? []) {
      const text = (block.text as { text?: string } | undefined)?.text ?? '';
      expect(Array.from(text).length).toBeLessThanOrEqual(3000);
      expect(text).not.toMatch(/&a?m?…/);
    }
  });

  it('AI ライターに渡したリンクは 5 件まで載せ、残りは件数だけ書く', () => {
    const links = Array.from({ length: 7 }, (_, i) => `https://example.com/n/${i}`);
    const message = buildUpdateMessage({ ...base, previousAt: 1, handoff: { links } });
    expect(texts(message)).toContain('AI ライターに渡したリンク: 7 件');
    expect(texts(message)).toContain('<https://example.com/n/4|https://example.com/n/4>');
    expect(texts(message)).not.toContain('n/5|');
    expect(texts(message)).toContain('ほか 2 件');
  });

  it('渡せなかった時はエラーを書く', () => {
    const message = buildUpdateMessage({ ...base, previousAt: 1, handoff: { links: [], error: 'UNAVAILABLE <!here>' } });
    expect(texts(message)).toContain('AI ライターに渡せませんでした');
    expect(texts(message)).not.toContain('<!here>');
  });

  it('差分が空なら差分の欄を出さない', () => {
    expect(texts(buildUpdateMessage({ ...base, diff: '' }))).not.toContain('*差分*');
  });

  it('リンクの記法を壊す文字 (| と >) を URL に含めない', () => {
    const message = buildUpdateMessage({ ...base, target: { ...target, url: 'https://example.com/a|b>c' } });
    expect(texts(message)).toContain('<https://example.com/a%7Cb%3Ec|');
  });

  it('http(s) 以外の URL はリンクにしない', () => {
    const message = buildUpdateMessage({ ...base, target: { ...target, url: 'javascript:alert(1)' } });
    expect(texts(message)).not.toContain('javascript:');
  });
});

describe('buildErrorMessage', () => {
  it('エラーの内容をエスケープして載せる', () => {
    const message = buildErrorMessage(target, siteUrl, new Error('HTTP 500 <!channel>'));
    expect(message.text).toBe('[サンプル公式サイト] でエラーが発生しました');
    expect(texts(message)).toContain('HTTP 500 &lt;!channel&gt;');
  });
});

describe('buildNoContentMessage', () => {
  it('URL とセレクタを載せる', () => {
    const message = buildNoContentMessage(target, siteUrl);
    expect(message.text).toBe('[サンプル公式サイト] でコンテンツが存在しませんでした');
    expect(texts(message)).toContain('`#news`');
  });
});
