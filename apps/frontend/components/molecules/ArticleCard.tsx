import Link from 'next/link';
import { CategoryChip } from './CategoryChip';
import { getArticleUrl, type ArticleIndexItem } from '@/lib/mdx/articles';

type Variant = 'default' | 'feature';

type Props = {
  article: ArticleIndexItem;
  variant?: Variant;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

export const ArticleCard = ({ article, variant = 'default' }: Props) => {
  const isFeature = variant === 'feature';

  return (
    <article
      className={`
        group relative overflow-hidden bg-bg-elevated
        border border-[var(--line-soft)] hover:border-primary-300
        transition-colors duration-200
        before:absolute before:inset-x-0 before:top-0 before:h-[2px]
        before:bg-gradient-to-r before:from-primary-500 before:to-accent-yellow-deep
        before:-translate-x-full hover:before:translate-x-0
        before:transition-transform before:duration-500 before:ease-out
        ${isFeature ? 'p-8 md:p-12 md:grid md:grid-cols-[1fr_auto] md:gap-10 md:items-end' : 'p-6'}
      `}
    >
      <Link
        href={getArticleUrl(article)}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
      >
        <div className="flex flex-col gap-3">
          {article.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {article.categories.map((cat) => (
                <CategoryChip key={cat} name={cat} size="sm" />
              ))}
            </div>
          )}

          <h3
            className={`font-display text-ink-strong group-hover:text-primary-700 transition-colors leading-tight ${
              isFeature ? 'text-2xl md:text-4xl' : 'text-lg md:text-xl'
            }`}
          >
            {article.title}
          </h3>

          {article.excerpt && (
            <p
              className={`text-ink-body leading-relaxed ${
                isFeature ? 'text-base md:text-lg max-w-prose' : 'text-sm line-clamp-3'
              }`}
            >
              {article.excerpt}
            </p>
          )}

          <div className="mt-auto flex items-center gap-2 text-xs text-ink-muted">
            <time
              className="font-numeric tabular-nums tracking-wide"
              dateTime={article.date}
            >
              {formatDate(article.date)}
            </time>
            <span aria-hidden="true">·</span>
            <span>{article.author}</span>
          </div>
        </div>
      </Link>
    </article>
  );
};

export default ArticleCard;
