import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { createDocsLink, getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';
import { githubUrl, markdownUrl } from '@/lib/urls';

type Props = {
  params: Promise<{ slug?: string[] }>;
};

export default async function Page(props: Props) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const mdUrl = markdownUrl(page.slugs);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={mdUrl} />
        <ViewOptionsPopover markdownUrl={mdUrl} githubUrl={githubUrl(page.path)} />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createDocsLink(page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
