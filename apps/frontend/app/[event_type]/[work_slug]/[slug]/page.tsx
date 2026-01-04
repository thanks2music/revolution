import Layout from '@/components/templates/Layout';
import {
  getAllArticles,
  getArticleByPath,
  getArticleUrl,
  readArticleContentFile,
} from '@/lib/mdx/articles';
import { CustomMDX } from '@/components/mdx';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { parseFrontmatter } from '@/lib/mdx/utils';
import { generateArticleMetadata } from '@/lib/metadata';

// Generate static params for all articles (new URL structure)
export async function generateStaticParams() {
  const articles = getAllArticles();
  return articles
    .filter((article) => article.event_type && article.work_slug)
    .map((article) => ({
      event_type: article.event_type!,
      work_slug: article.work_slug!,
      slug: article.slug,
    }));
}

// Dynamic metadata
export async function generateMetadata(
  props: {
    params: Promise<{ event_type: string; work_slug: string; slug: string }>;
  }
) {
  const params = await props.params;
  const { event_type, work_slug, slug } = params;
  const article = getArticleByPath(event_type, work_slug, slug);

  if (!article) {
    return {
      title: 'Article Not Found',
    };
  }

  return generateArticleMetadata({
    title: article.title,
    description: article.excerpt,
    publishedTime: article.date,
    authors: [article.author],
    tags: article.tags,
    imageUrl: article.ogImage,
    slug: article.slug,
    path: getArticleUrl(article),
  });
}

export default async function ArticlePage(
  props: {
    params: Promise<{ event_type: string; work_slug: string; slug: string }>;
  }
) {
  const params = await props.params;
  const { event_type, work_slug, slug } = params;

  // Get article metadata from index
  const article = getArticleByPath(event_type, work_slug, slug);

  if (!article) {
    notFound();
  }

  // Read full MDX content using the full filePath
  const rawContent = readArticleContentFile(article.filePath);
  const { content } = parseFrontmatter(rawContent);

  return (
    <Layout>
      <article className="w-main mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900 dark:text-gray-100">
            {article.title}
          </h1>

          {/* Hero Image */}
          {article.ogImage && (
            <figure className="mb-6">
              <Image
                src={article.ogImage}
                alt={article.title}
                width={1200}
                height={630}
                priority
                className="rounded-lg w-full h-auto"
              />
            </figure>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-6">
            <time dateTime={article.date}>
              {new Date(article.date).toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span>·</span>
            <span>{article.author}</span>
          </div>

          {/* Categories */}
          {article.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {article.categories.map((category) => (
                <span
                  key={category}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm rounded-full"
                >
                  {category}
                </span>
              ))}
            </div>
          )}

          {/* Tags */}
          {article.tags && article.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* Excerpt */}
        {article.excerpt && (
          <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-4 border-blue-500">
            <p className="text-lg text-gray-700 dark:text-gray-300 italic">
              {article.excerpt}
            </p>
          </div>
        )}

        {/* Article Content */}
        <div className="prose prose-lg dark:prose-invert max-w-none">
          <CustomMDX source={content} />
        </div>

        {/* Footer Navigation */}
        <footer className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
          <Link
            href="/articles"
            className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to all articles
          </Link>
        </footer>
      </article>
    </Layout>
  );
}
