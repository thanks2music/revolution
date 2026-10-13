'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import type { SlideImage } from 'yet-another-react-lightbox';
import { toDimensions, toLightboxSlide } from '@/lib/mdx/article-image';

// 拡大表示の本体は、画像が押されてから読み込む (記事を開いただけでは読み込まない)
const ArticleLightbox = dynamic(() => import('./ArticleLightbox'), { ssr: false });

const IMAGE_SELECTOR = 'img[data-lightbox-src]';

function readSlide(image: HTMLImageElement): SlideImage {
  return toLightboxSlide({
    src: image.dataset.lightboxSrc!,
    alt: image.alt,
    ...toDimensions(image.dataset.lightboxWidth, image.dataset.lightboxHeight),
  });
}

/**
 * 記事の中の画像を押すと、拡大表示を開く (yet-another-react-lightbox + Zoom、2026-10-13 BOSS 決定)。
 * 記事のすべての画像 (冒頭のアイキャッチを含む) を 1 つのギャラリーとして左右に送れる。
 * 画像は `ArticleImageView` が `data-lightbox-*` を付けて出す。MDX の中の画像の一覧はサーバーに無いので、
 * 押された時点の DOM から集める
 */
export function ArticleGallery({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gallery, setGallery] = useState<{ slides: SlideImage[]; index: number } | null>(null);

  function open(target: EventTarget | null): boolean {
    const container = containerRef.current;
    const image = target instanceof Element ? target.closest<HTMLImageElement>(IMAGE_SELECTOR) : null;
    // リンクで包んだ画像は、拡大表示ではなくリンクの移動を優先する
    if (!container || !image || image.closest('a')) return false;
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR));
    setGallery({ slides: images.map(readSlide), index: Math.max(images.indexOf(image), 0) });
    return true;
  }

  // 拡大表示は記事の要素の外に置く (中にあると、拡大表示の中のクリックやキー入力も open に届く)
  return (
    <>
      <div
        ref={containerRef}
        onClick={(event) => open(event.target)}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && open(event.target)) event.preventDefault();
        }}
      >
        {children}
      </div>
      {gallery && (
        <ArticleLightbox slides={gallery.slides} index={gallery.index} close={() => setGallery(null)} />
      )}
    </>
  );
}

export default ArticleGallery;
