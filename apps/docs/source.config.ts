import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { defineConfig } from 'fumadocs-mdx/config';

// コレクション (lib/source.ts) は Macro API で定義する。ここには全体の MDX 設定だけを置く。
// コレクション側で mdxOptions を指定すると既定のプラグイン (見出し ID・画像・検索用の
// 構造化など) が外れるため、追加のプラグインは必ずここに書く。
export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
  },
});
