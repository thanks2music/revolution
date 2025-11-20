import Layout from '@/components/templates/Layout';
import { Metadata } from 'next';
import { ISR_CONFIG } from '@/lib/swrConfig';
import { getLatestArticles } from '@/lib/mdx/articles';
import Link from 'next/link';

// ISR設定をexport
export const revalidate = ISR_CONFIG.revalidate; // 120秒

// New metadata API
export const metadata: Metadata = {
  title: 'Revolution Platform - Home',
  description: 'Next.js + WordPress Headless CMS with ISR × useSWR | MDX Articles',
};

// Server Component: ISRで初期データ取得
export default async function Home() {
  // MDX記事取得
  const mdxArticles = getLatestArticles(10);

  return (
    <Layout>
      {mdxArticles.length > 0 && (
        <section className="mb-12">
          <h2 className="text-3xl font-bold mb-6">Latest MDX Articles</h2>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
            {mdxArticles.map(article => (
              <article
                key={article.slug}
                className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow"
              >
                <Link href={`/articles/${article.slug}`}>
                  <h3 className="text-xl font-semibold mb-2 text-gray-900 hover:text-blue-600">
                    {article.title}
                  </h3>
                  <p className="text-gray-600 text-sm mb-3">{article.excerpt}</p>
                  <div className="flex items-center text-xs text-gray-500">
                    <time dateTime={article.date}>
                      {new Date(article.date).toLocaleDateString('ja-JP')}
                    </time>
                    <span className="mx-2">·</span>
                    <span>{article.author}</span>
                  </div>
                  {article.categories.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {article.categories.map(cat => (
                        <span
                          key={cat}
                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </article>
            ))}
          </div>

          <div className="flex justify-center">
            <Link
              href="/articles"
              className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              View all →
            </Link>
          </div>
        </section>
      )}
    </Layout>
  );
}
