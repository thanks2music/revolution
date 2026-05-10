import Layout from '@/components/templates/Layout';
import {
  getAllArticles,
  getArticleByPath,
  getArticleUrl,
  getRelatedArticles,
  readArticleContentFile,
} from '@/lib/mdx/articles';
import { CustomMDX } from '@/components/mdx';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { parseFrontmatter } from '@/lib/mdx/utils';
import { generateArticleMetadata } from '@/lib/metadata';
import type { ArticlePagePropsNew } from '@/types/page-props';
import { CategoryChip } from '@/components/molecules/CategoryChip';
import { SparkRule } from '@/components/atoms/ornament/SparkRule';
import { EventFactCard } from '@/components/molecules/EventFactCard';
import { RelatedArticles } from '@/components/organisms/RelatedArticles';

export const revalidate = 120; // ISR (home と同じ 2 分)

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

export async function generateMetadata(props: ArticlePagePropsNew) {
  const params = await props.params;
  const { event_type, work_slug, slug } = params;
  const article = getArticleByPath(event_type, work_slug, slug);

  if (!article) {
    return { title: '記事が見つかりません — Revolution' };
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

const formatLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export default async function ArticlePage(props: ArticlePagePropsNew) {
  const params = await props.params;
  const { event_type, work_slug, slug } = params;

  const article = getArticleByPath(event_type, work_slug, slug);
  if (!article) notFound();

  const rawContent = readArticleContentFile(article.filePath);
  const { content } = parseFrontmatter(rawContent);
  const related = getRelatedArticles(article);

  return (
    <Layout hidePt>
      <article className="w-main mx-auto">
        <header className="pt-12 md:pt-16">
          <p className="font-numeric tabular-nums text-xs tracking-[0.22em] text-ink-muted uppercase">
            {article.event_title ?? 'Article'}
            {article.work_title ? ` / ${article.work_title}` : ''}
          </p>
          <SparkRule className="mt-2 mb-6" width="3em" />

          {article.categories.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-1.5">
              {article.categories.map((cat) => (
                <CategoryChip key={cat} name={cat} size="sm" />
              ))}
            </div>
          )}

          <h1 className="font-display text-3xl leading-[1.15] text-ink-strong sm:text-4xl md:text-5xl">
            {article.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <time
              dateTime={article.date}
              className="font-numeric tabular-nums tracking-wide"
            >
              {formatLongDate(article.date)}
            </time>
            <span aria-hidden="true">·</span>
            <span>{article.author}</span>
          </div>
        </header>

        <div className="mt-10 md:mt-14 md:grid md:grid-cols-[minmax(0,1fr)_300px] md:gap-12">
          <div>
            {article.excerpt && (
              <p className="bg-bg-tinted border-l-[3px] border-primary-500 mb-8 px-5 py-4 text-base leading-relaxed text-ink-body md:text-lg">
                {article.excerpt}
              </p>
            )}
            <div className="article-body">
              <CustomMDX source={content} />
            </div>
          </div>

          <div className="mt-10 md:mt-0 md:sticky md:top-6 md:self-start">
            <EventFactCard article={article} />
          </div>
        </div>

        <RelatedArticles related={related} />

        <footer className="mt-section-sp md:mt-section-pc border-t pt-8">
          <Link
            href="/articles"
            className="font-display inline-flex items-center gap-1.5 text-sm tracking-wide text-primary-600 transition-colors hover:text-primary-700"
          >
            <span aria-hidden="true">←</span>
            記事一覧へ戻る
          </Link>
        </footer>
      </article>
    </Layout>
  );
}
