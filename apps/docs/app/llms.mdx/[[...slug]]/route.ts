import { notFound } from 'next/navigation';

import { docsLLMs } from '@/lib/llms';
import { source } from '@/lib/source';
import { markdownSegments, slugsFromMarkdownUrl } from '@/lib/urls';

// /<page>.md は next.config.mjs の rewrites でここに来る。
export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = source.getPage(slugsFromMarkdownUrl(slug));
  if (!page) notFound();

  return new Response(await docsLLMs.page(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map(page => ({ slug: markdownSegments(page.slugs) }));
}
