import { describe, expect, it } from '@jest/globals';

import {
  docsSlugs,
  githubUrl,
  markdownSegments,
  markdownUrl,
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

  it('repo の外を指すものは対象外', () => {
    expect(toRepoBlobUrl('README.md', '../../outside.md')).toBeUndefined();
  });
});
