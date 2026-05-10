import { ArticleCard } from '@/components/molecules/ArticleCard';
import type { ArticleIndexItem } from '@/lib/mdx/articles';

type Props = {
  articles: ArticleIndexItem[];
  /** `auto`: 1 件はマガジン feature、複数件はグリッド。`grid`: 常にグリッド。 */
  layout?: 'auto' | 'grid';
};

const COLS_BY_COUNT: Record<1 | 2, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
};
const gridClass = (count: number) => COLS_BY_COUNT[count as 1 | 2] ?? 'md:grid-cols-2 lg:grid-cols-3';

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
        <ArticleCard key={article.slug} article={article} />
      ))}
    </div>
  );
};

export default ArticleGrid;
