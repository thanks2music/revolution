import { describe, expect, it } from '@jest/globals';

import {
  docsSlugs,
  githubUrl,
  markdownSegments,
  markdownUrl,
  pickDocsHref,
  rewriteRelativeLinks,
  slugsFromMarkdownUrl,
  toRepoBlobUrl,
} from '@/lib/urls';

const BLOB = 'https://github.com/thanks2music/revolution/blob/main';

describe('docsSlugs', () => {
  it('docs/README.md をトップ (/) にする', () => {
    expect(docsSlugs('README.md')).toEqual([]);
  });

  it('それ以外は既定 (ファイル名) に任せる', () => {
    expect(docsSlugs('overview.md')).toBeUndefined();
  });
});

describe('Markdown 版の URL', () => {
  it('トップは /index.md、それ以外は /<page>.md', () => {
    expect(markdownUrl([])).toBe('/index.md');
    expect(markdownUrl(['overview'])).toBe('/overview.md');
  });

  it('slugsFromMarkdownUrl は markdownSegments の逆になる', () => {
    for (const slugs of [[], ['overview']]) {
      expect(slugsFromMarkdownUrl(markdownSegments(slugs))).toEqual(slugs);
    }
  });
});

describe('githubUrl', () => {
  it('docs/ 配下の元ファイルを指す', () => {
    expect(githubUrl('sentry.md')).toBe(`${BLOB}/docs/sentry.md`);
  });
});

describe('toRepoBlobUrl', () => {
  it('docs の外のファイルへのリンクを GitHub の URL にする', () => {
    expect(toRepoBlobUrl('ai-writer-cloud-run.md', '../.github/workflows/deploy-ai-writer.yml')).toBe(
      `${BLOB}/.github/workflows/deploy-ai-writer.yml`
    );
  });

  it('サイトから外した archive/ へのリンクも GitHub の URL にする', () => {
    expect(toRepoBlobUrl('README.md', './archive/branch-protection.md')).toBe(
      `${BLOB}/docs/archive/branch-protection.md`
    );
  });

  it('アンカーを保つ', () => {
    expect(toRepoBlobUrl('README.md', '../apps/ai-writer/README.md#setup')).toBe(
      `${BLOB}/apps/ai-writer/README.md#setup`
    );
  });

  it('相対リンクでないものは対象外', () => {
    expect(toRepoBlobUrl('README.md', 'https://example.com')).toBeUndefined();
    expect(toRepoBlobUrl('README.md', '#section')).toBeUndefined();
    expect(toRepoBlobUrl('README.md', '/overview')).toBeUndefined();
  });

  it('repo の外を指すものは対象外 (正規化してちょうど .. になるものも)', () => {
    expect(toRepoBlobUrl('README.md', '../../outside.md')).toBeUndefined();
    expect(toRepoBlobUrl('README.md', '../..')).toBeUndefined();
  });

  it('repo のルートを指すものは repo のトップにする', () => {
    expect(toRepoBlobUrl('README.md', '../')).toBe('https://github.com/thanks2music/revolution');
  });
});

describe('pickDocsHref', () => {
  it('Fumadocs がサイトのページに解決したらその URL', () => {
    expect(pickDocsHref('./sentry.md#x', 'README.md', '/sentry#x')).toBe('/sentry#x');
  });

  it('サイトのページに当たらない相対リンクは GitHub の URL', () => {
    expect(pickDocsHref('./archive/x.md', 'README.md', './archive/x.md')).toBe(
      `${BLOB}/docs/archive/x.md`
    );
  });

  it('相対リンクでなければそのまま', () => {
    expect(pickDocsHref('https://example.com', 'README.md', 'https://example.com')).toBe(
      'https://example.com'
    );
  });
});

describe('rewriteRelativeLinks', () => {
  const rewrite = (href: string) => `<${href}>`;

  it('リンクと画像の相対パスだけを書き換える', () => {
    expect(rewriteRelativeLinks('[a](./a.md) ![b](../b.png) [c](https://c) [d](#d)', rewrite)).toBe(
      '[a](<./a.md>) ![b](<../b.png>) [c](https://c) [d](#d)'
    );
  });

  it('フェンスの中は書き換えない (閉じた後は書き換える)', () => {
    const md = ['```md', '[a](./a.md)', '```', '[b](./b.md)'].join('\n');
    expect(rewriteRelativeLinks(md, rewrite)).toBe(
      ['```md', '[a](./a.md)', '```', '[b](<./b.md>)'].join('\n')
    );
  });

  it('開いた時より短いフェンスや別の文字では閉じない', () => {
    const md = ['````', '```', '[a](./a.md)', '~~~', '````', '[b](./b.md)'].join('\n');
    expect(rewriteRelativeLinks(md, rewrite).split('\n')).toEqual([
      '````',
      '```',
      '[a](./a.md)',
      '~~~',
      '````',
      '[b](<./b.md>)',
    ]);
  });

  it('後ろに info string がある行ではフェンスを閉じない', () => {
    const md = ['```md', '```js', '[a](./a.md)', '```', '[b](./b.md)'].join('\n');
    expect(rewriteRelativeLinks(md, rewrite).split('\n')).toEqual([
      '```md',
      '```js',
      '[a](./a.md)',
      '```',
      '[b](<./b.md>)',
    ]);
  });
});
