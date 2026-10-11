import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';

import { docsSlugs, toRepoBlobUrl } from '@/lib/urls';

// repo 直下の docs/ を読む (コピーしない)。載せるのは直下の *.md だけで、
// archive/ と gitignored の plan/ report/ research/ はここで構造的に外れる。
export const docs = defineDocs({
  dir: '../../docs',
  docs: {
    files: ['*.md'],
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    files: ['meta.json'],
  },
});

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  slugs: file => docsSlugs(file.path),
});

export type DocsPage = (typeof source)['$inferPage'];

/**
 * 本文中のリンクの行き先を決める。サイトのページへの相対リンクはそのページの URL に、
 * サイトに載らないファイルへの相対リンクは GitHub 上の URL にする。それ以外はそのまま。
 */
export function resolveDocsHref(href: string, page: DocsPage): string {
  const resolved = source.resolveHref(href, page);
  if (resolved !== href) return resolved;
  return toRepoBlobUrl(page.path, href) ?? href;
}
