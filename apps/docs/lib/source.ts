import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';

import { docsSlugs, pickDocsHref } from '@/lib/urls';

// repo 直下の docs/ を読む (コピーしない)。載せるのは直下の *.md だけなので、
// archive/ と gitignored の plan/ report/ research/ はここで外れる。直下に置かれる
// gitignored のファイル (.gitignore の docs/*secret*.md / docs/TOC.*.md) は明示的に外す
// (ローカルの dev / build で検索や llms-full.txt に混ざらないように)。
// pipeline.md は private repo へ移設中 (revolution #358) で、公開側に step 数を出さないため載せない。
export const docs = defineDocs({
  dir: '../../docs',
  docs: {
    files: ['*.md', '!*secret*.md', '!TOC.*.md', '!pipeline.md'],
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

/** 本文中のリンクの行き先 (決め方は lib/urls.ts の pickDocsHref)。 */
export function resolveDocsHref(href: string, page: DocsPage): string {
  return pickDocsHref(href, page.path, source.resolveHref(href, page));
}
