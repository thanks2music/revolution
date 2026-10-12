import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { llms } from 'fumadocs-core/source';

import { type DocsPage, resolveDocsHref, source } from '@/lib/source';
import { rewriteRelativeLinks } from '@/lib/urls';

/**
 * ページの Markdown 版 (/<page>.md・llms-full.txt・Copy Markdown)。
 *
 * 公式の例は getText('processed') を使うが、それだと remark の処理後になり、
 * Mermaid のコードブロックが <Mermaid chart=... /> の JSX で出る。docs/ は素の Markdown なので、
 * 書いたままの本文 (raw) から frontmatter を外して使う。相対リンクはサイトのページか
 * GitHub 上の URL に書き換える (Markdown 版の URL からの相対ではリンク切れになるため)。
 */
async function renderPage(page: DocsPage): Promise<string> {
  const { content } = frontmatter(await page.data.getText('raw'));
  const body = rewriteRelativeLinks(content, href => resolveDocsHref(href, page));

  return `# ${page.data.title} (${page.url})

${body.trimStart()}`;
}

/** llms.txt (index) / llms-full.txt (full) / 各ページの .md (page) */
export const docsLLMs = llms(source, { renderPage });
