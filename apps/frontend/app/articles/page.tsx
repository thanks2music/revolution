import Layout from '@/components/templates/Layout';
import { getAllArticles, getAllCategories, getAllTags } from '@/lib/mdx/articles';
import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'All Articles - Revolution Platform',
  description: 'Browse all MDX articles on Revolution Platform',
};

export default function ArticlesPage() {
  const articles = getAllArticles();
  const categories = getAllCategories();
  const tags = getAllTags();

  return (
    <Layout>
      <div className="w-main mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">All Articles</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {articles.length} {articles.length === 1 ? 'article' : 'articles'} available
          </p>
        </div>

        {/* Categories & Tags */}
        {(categories.length > 0 || tags.length > 0) && (
          <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
            {categories.length > 0 && (
              <div className="mb-4">
                <h2 className="text-lg font-semibold mb-2">Categories</h2>
                <div className="flex flex-wrap gap-2">
                  {categories.map(category => (
                    <span
                      key={category}
                      className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm rounded-full"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-2">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Articles Grid */}
        {articles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400 text-lg">
              No articles available yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {articles.map(article => (
              <article
                key={article.slug}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 hover:shadow-lg transition-shadow"
              >
                <Link href={`/articles/${article.slug}`}>
                  <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
                    {article.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-3">
                    {article.excerpt}
                  </p>
                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-500 mb-3">
                    <time dateTime={article.date}>
                      {new Date(article.date).toLocaleDateString('ja-JP')}
                    </time>
                    <span className="mx-2">·</span>
                    <span>{article.author}</span>
                  </div>
                  {article.categories.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {article.categories.map(cat => (
                        <span
                          key={cat}
                          className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-xs rounded"
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
        )}
      </div>
    </Layout>
  );
}
