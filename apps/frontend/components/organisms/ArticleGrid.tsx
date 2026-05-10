import { ArticleCard } from '@/components/molecules/ArticleCard';
import type { ArticleIndexItem } from '@/lib/mdx/articles';

type Props = {
  articles: ArticleIndexItem[];
  /** `auto`: 1 件はマガジン feature、複数件はグリッド。`grid`: 常にグリッド。 */
  layout?: 'auto' | 'grid';
};

const gridClass = (count: number): string => {
  if (count === 1) return 'md:grid-cols-1';
  if (count === 2) return 'md:grid-cols-2';
  return 'md:grid-cols-2 lg:grid-cols-3';
};

export const ArticleGrid = ({ articles, layout = 'auto' }: Props) => {
  if (articles.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-ink-muted">
        まだ記事はありません。
      </p>
    );
  }

  if (layout === 'auto' && articles.length === 1) {
    return <ArticleCard article={articles[0]} variant="feature" />;
  }

  return (
    <div className={`grid grid-cols-1 ${gridClass(articles.length)} gap-5 md:gap-6`}>
      {articles.map((article) => (
        <ArticleCard key={article.filePath} article={article} />
      ))}
    </div>
  );
};

export default ArticleGrid;
