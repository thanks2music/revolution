import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMDX } from 'fumadocs-mdx/next';

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // コンテンツは repo 直下の docs/ にある (lib/source.ts)。Turbopack が解決できるのは
  // root より下だけなので、monorepo のルートを明示する。worktree では親 repo の
  // lockfile も見つかり、推定の root がずれるため推定に任せない。
  turbopack: {
    root: monorepoRoot,
  },

  // 公開はするが検索エンジンには載せない (BOSS 決定 2026-10-11)。HTML は root layout の
  // metadata.robots でも出すが、.md / llms*.txt には meta タグが無いのでヘッダーで付ける。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },

  // ページの URL に .md を付けると Markdown 版を返す (Copy Markdown / LLM 向け)。
  async rewrites() {
    return [
      {
        source: '/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
