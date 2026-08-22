import Link from 'next/link';
// fs を持つ articles.ts ではなく client-safe な分割モジュールから import
// (PaginatedArticleGrid 経由で Client Component bundle に取り込まれるため)
import { getArticleUrl } from '@/lib/mdx/article-url';
import type { ArticleIndexItem } from '@/lib/mdx/article-types';

/**
 * 記事カード。
 *
 * ## 意匠 (Claude Design v6 #17/#18、2026-08-22 全面変更)
 *
 * **クリーム地 + 明朝見出し**。記事だけがサイト内で唯一この活字トーンを持ち、
 * 「開催情報 (青・サンセリフ) と読み物 (クリーム・明朝) は別種のコンテンツ」
 * という区別を視覚言語で表す。
 *
 * ⚠️ **v6 の規約に従い、カード内のカテゴリチップと抜粋を撤去した** (2026-08-22
 *    BOSS 承認)。旧実装は白地 + サンセリフ + チップ + 抜粋で、情報量は多かったが
 *    記事と開催の区別が付いていなかった。カテゴリでの絞り込みは
 *    `/titles/{slug}/articles` のチップ行と `/articles?category=` が担う。
 *
 * ⚠️ v6 の記事メタ行の指定色 `#9C8756` は 3.38:1 で WCAG AA を割るため、
 *    `--ink-article-muted` (#806c3e、4.92:1) へ是正した。経緯は
 *    `styles/globals.css` のトークン定義を参照。
 *
 * ## `feature` variant は v6 の対象外
 *
 * トップ先頭の大型カードは **v5 #1 ホームの領域**で、v6 は触れていない。
 * 構成ごと見直す「トップ改修」タスクで判断するため、ここでは寸法だけを
 * 引き継ぎ、意匠は default と揃えている。
 */

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
        group relative overflow-hidden bg-article
        border border-article-line hover:border-article-muted
        transition-colors duration-200
        ${isFeature ? 'p-8 md:p-12' : 'p-6'}
      `}
    >
      <Link
        href={getArticleUrl(article)}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-article"
      >
        <div className="flex flex-col gap-2">
          {/*
            メタ行 (日付 ・ 署名) を見出しの上に置く。v6 の記事カードの構成。
            ⚠️ 署名は実データの author をそのまま出す。v5/v6 が描く
               「AIライター『イベ子』」への読み替えは別タスク
               (Todoist 6hJWGP8jm4h688m8) で、本 PR では触らない。
          */}
          <div className="flex items-center gap-2 text-xs text-article-muted">
            <time className="font-numeric tabular-nums tracking-wide" dateTime={article.date}>
              {formatDate(article.date)}
            </time>
            <span aria-hidden="true">・</span>
            <span>{article.author}</span>
          </div>

          <h3
            className={`font-serif font-semibold leading-snug text-article-ink transition-colors group-hover:text-primary-700 ${
              isFeature ? 'text-2xl md:text-4xl' : 'text-lg md:text-xl'
            }`}
          >
            {article.title}
          </h3>
        </div>
      </Link>
    </article>
  );
};

export default ArticleCard;
