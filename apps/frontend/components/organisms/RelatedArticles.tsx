import { ArticleGrid } from '@/components/organisms/ArticleGrid';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import type { ArticleIndexItem } from '@/lib/mdx/articles';

type Props = {
  related: ArticleIndexItem[];
};

export const RelatedArticles = ({ related }: Props) => {
  if (related.length === 0) return null;

  return (
    <section className="mt-section-sp md:mt-section-pc">
      <SectionHeader
        eyebrow="No. 003 / Related"
        title="関連記事"
        subtitle="同じ作品や同じカテゴリの最新。"
      />
      <ArticleGrid articles={related} layout="grid" />
    </section>
  );
};

export default RelatedArticles;
