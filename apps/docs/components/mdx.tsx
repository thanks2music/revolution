import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';

import { Mermaid } from '@/components/mdx/mermaid';
import { type DocsPage, resolveDocsHref } from '@/lib/source';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Mermaid,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

/**
 * 本文の <a>。公式の createRelativeLink と同じくページへの相対リンクを解決し、
 * 加えてサイトに載らないファイルへのリンクを GitHub 上の URL にする (Server Component 専用)。
 */
export function createDocsLink(page: DocsPage) {
  const Link = defaultMdxComponents.a;

  return function DocsLink({ href, ...props }: ComponentProps<'a'>) {
    return <Link href={href ? resolveDocsHref(href, page) : href} {...props} />;
  };
}
