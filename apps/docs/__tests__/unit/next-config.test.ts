import type { NextConfig } from 'next';

// .md / llms*.txt には <meta name="robots"> が無いので、noindex はヘッダーだけが頼り。
// ヘッダーが消えても画面は変わらず気づけないため、設定そのものを固定する (metadata.test.ts と対)。
// fumadocs-mdx/next は ESM のみで jest から読めない。確かめたいのは自分の設定なので、
// createMDX は設定をそのまま返すものに差し替える。
jest.mock('fumadocs-mdx/next', () => ({ createMDX: () => (config: NextConfig) => config }));

async function loadConfig(): Promise<NextConfig> {
  return (await import('../../next.config.mjs')).default as NextConfig;
}

describe('next.config.mjs', () => {
  it('adds X-Robots-Tag: noindex to every path', async () => {
    const config = await loadConfig();
    const headers = await config.headers!();

    expect(headers).toContainEqual({
      source: '/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    });
  });

  it('serves the Markdown version of a page at <page>.md', async () => {
    const config = await loadConfig();
    const rewrites = await config.rewrites!();

    expect(rewrites).toContainEqual({ source: '/:path*.md', destination: '/llms.mdx/:path*' });
  });
});
