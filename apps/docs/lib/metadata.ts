import type { Metadata } from 'next';

export const siteName = 'anime-events.com Docs';

/**
 * root layout の metadata。公開はするが検索エンジンには載せない (BOSS 決定 2026-10-11)。
 * frontend と同じく robots.txt の disallow は使わない (apps/frontend/lib/metadata.ts 参照)。
 * .md / llms*.txt には meta タグが無いので、next.config.mjs の X-Robots-Tag でも付けている。
 */
export const rootMetadata: Metadata = {
  title: {
    template: `%s | ${siteName}`,
    default: siteName,
  },
  robots: { index: false, follow: true },
};
