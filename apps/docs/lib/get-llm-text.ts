import { type DocsPage, resolveDocsHref } from '@/lib/source';
import { rewriteRelativeLinks, stripFrontmatter } from '@/lib/urls';

/**
 * ページの Markdown 版 (/<page>.md・llms-full.txt・Copy Markdown)。
 *
 * 公式の例は getText('processed') を使うが、それだと remark の処理後になり、
 * Mermaid のコードブロックが <Mermaid chart=... /> の JSX で出る。docs/ は素の Markdown なので、
 * 書いたままの本文 (raw) から frontmatter を外して使う。相対リンクはサイトのページか
 * GitHub 上の URL に書き換える (Markdown 版の URL からの相対ではリンク切れになるため)。
 */
export async function getLLMText(page: DocsPage): Promise<string> {
  const raw = await page.data.getText('raw');
  const body = rewriteRelativeLinks(stripFrontmatter(raw), href => resolveDocsHref(href, page));

  return `# ${page.data.title} (${page.url})

${body.trimStart()}`;
}
