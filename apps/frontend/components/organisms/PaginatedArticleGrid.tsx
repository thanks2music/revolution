'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 注: prop 変化での visibleCount リセットは parent 側の `key` prop による remount で実現する
// (React 公式 "You Might Not Need an Effect — Resetting all state when a prop changes")。
// useEffect で setState する反パターンを避けるため、本コンポーネント内ではリセット effect を持たない。
import { ArticleCard } from '@/components/molecules/ArticleCard';
// 必ず client-safe な分割モジュールから import (articles.ts は fs 依存)
import type { ArticleIndexItem } from '@/lib/mdx/article-types';

type PaginationMode = 'button' | 'infinite';

type Props = {
  articles: ArticleIndexItem[];
  /**
   * - `button`: 「もっと記事を表示する」ボタンでクリック時に +pageSize 件追加 (トップページ用)
   * - `infinite`: 末尾の sentinel が viewport に入ったら自動で +pageSize 件追加 (/articles 用)
   */
  mode: PaginationMode;
  /** 初回表示件数 + 1 ロードあたりの追加件数。3 列レイアウトに合わせて 21 (= 3 × 7 行) を既定とする。 */
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 21;

/**
 * クライアント側で visibleCount を state 管理し、新規追加された記事カードに
 * `animate-fade-in-up` を当てる。article-index.json は SSG ビルド時に全件
 * クライアントへ届くため、追加 fetch は不要 (slice のみ)。
 *
 * SEO: SSG/ISR の初期 HTML には `articles.slice(0, pageSize)` の N 件が乗る。
 * クローラに 21 件超を見せたい場合は別途 `<noscript>` または別 SSG ルートで対応する想定。
 */
export const PaginatedArticleGrid = ({
  articles,
  mode,
  pageSize = DEFAULT_PAGE_SIZE,
}: Props) => {
  const total = articles.length;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(pageSize, total));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => {
    setVisibleCount((current) => Math.min(current + pageSize, total));
  }, [pageSize, total]);

  // infinite モードのみ IntersectionObserver で自動ロード
  useEffect(() => {
    if (mode !== 'infinite') return;
    if (visibleCount >= total) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMore();
            break;
          }
        }
      },
      { rootMargin: '200px 0px' }, // やや早めに発火させて読込のもたつきを隠す
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mode, visibleCount, total, loadMore]);

  const visible = useMemo(() => articles.slice(0, visibleCount), [articles, visibleCount]);

  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-ink-muted">まだ記事はありません。</p>
    );
  }

  const hasMore = visibleCount < total;

  return (
    <>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
        {visible.map((article, index) => (
          <div
            key={article.filePath}
            // 初期表示分はアニメさせず、ロード後に追加された分だけ fade-in
            className={index >= pageSize ? 'animate-fade-in-up' : undefined}
          >
            <ArticleCard article={article} />
          </div>
        ))}
      </div>

      {hasMore && mode === 'button' && (
        <div className="mt-section-sp md:mt-section-pc flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            className="font-display border-primary-500 text-primary-700 hover:bg-primary-500 inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm tracking-wide transition-colors hover:text-white"
          >
            もっと記事を表示する
            <span aria-hidden="true">↓</span>
            <span className="font-numeric tabular-nums text-xs opacity-75">
              ({visibleCount} / {total})
            </span>
          </button>
        </div>
      )}

      {hasMore && mode === 'infinite' && (
        <div ref={sentinelRef} aria-hidden="true" className="h-10 w-full" />
      )}

      {!hasMore && total > pageSize && (
        <p className="mt-12 text-center text-sm text-ink-muted">
          全 <span className="font-numeric tabular-nums">{total}</span> 本を表示しました。
        </p>
      )}
    </>
  );
};

export default PaginatedArticleGrid;
