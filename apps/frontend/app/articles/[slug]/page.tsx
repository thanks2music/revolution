import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CustomMDX from '@/components/mdx';
import { getPostBySlug, getPosts } from '@/lib/mdx/utils';

interface ArticlePageProps {
  params: Promise<{
    slug: string;
  }>;
}

/**
 * 静的パス生成（SSG）
 * ビルド時に全記事のページを生成
 */
export async function generateStaticParams() {
  const posts = getPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

/**
 * メタデータ生成
 * SEO最適化のためのメタタグ
 */
export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return {
      title: 'Article Not Found',
    };
  }

  const { metadata } = post;

  return {
    title: metadata.title,
    description: metadata.excerpt,
    openGraph: {
      title: metadata.title,
      description: metadata.excerpt,
      type: 'article',
      publishedTime: metadata.date,
      authors: [metadata.author],
      images: metadata.ogImage || metadata.featuredImage ? [
        {
          url: metadata.ogImage || metadata.featuredImage || '',
          alt: metadata.title,
        }
      ] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: metadata.title,
      description: metadata.excerpt,
      images: metadata.ogImage || metadata.featuredImage ? [metadata.ogImage || metadata.featuredImage || ''] : undefined,
    },
  };
}

/**
 * 記事ページコンポーネント
 */
export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const { metadata, content } = post;

  return (
    <article className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <header className="mb-8">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">{metadata.title}</h1>

        {/* メタ情報 */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
          <time dateTime={metadata.date}>
            {new Date(metadata.date).toLocaleDateString('ja-JP', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
          <span>著者: {metadata.author}</span>
        </div>

        {/* カテゴリ・タグ */}
        <div className="flex flex-wrap gap-2 mb-4">
          {metadata.categories?.map((category) => (
            <span
              key={category}
              className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm"
            >
              {category}
            </span>
          ))}
        </div>

        {metadata.tags && metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {metadata.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Featured Image */}
        {(metadata.featuredImage || metadata.ogImage) && (
          <div className="mt-6 rounded-lg overflow-hidden">
            <img
              src={metadata.featuredImage || metadata.ogImage}
              alt={metadata.title}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Excerpt */}
        {metadata.excerpt && (
          <p className="mt-6 text-lg text-gray-600 dark:text-gray-400 italic border-l-4 border-gray-300 dark:border-gray-700 pl-4">
            {metadata.excerpt}
          </p>
        )}
      </header>

      {/* MDXコンテンツ */}
      <div className="prose prose-lg dark:prose-invert max-w-none">
        <CustomMDX source={content} />
      </div>

      {/* フッター */}
      <footer className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">タグ:</span>
          {metadata.tags?.map((tag) => (
            <a
              key={tag}
              href={`/tags/${tag}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              #{tag}
            </a>
          ))}
        </div>
      </footer>
    </article>
  );
}
