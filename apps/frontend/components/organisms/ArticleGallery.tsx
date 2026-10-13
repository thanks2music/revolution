'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import { toLightboxSlide, type LightboxSlide } from '@/lib/mdx/article-image';

// 拡大表示の本体は、画像が押されてから読み込む (記事を開いただけでは読み込まない)
const ArticleLightbox = dynamic(() => import('./ArticleLightbox'), { ssr: false });

const IMAGE_SELECTOR = 'img[data-lightbox-src]';

function toPositiveNumber(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function readSlide(image: HTMLImageElement): LightboxSlide {
  return toLightboxSlide({
    src: image.dataset.lightboxSrc ?? image.currentSrc,
    alt: image.alt,
    width: toPositiveNumber(image.dataset.lightboxWidth),
    height: toPositiveNumber(image.dataset.lightboxHeight),
  });
}

/**
 * 記事の中の画像を押すと、拡大表示を開く (yet-another-react-lightbox + Zoom、2026-10-13 BOSS 決定)。
 * 記事のすべての画像 (冒頭のアイキャッチを含む) を 1 つのギャラリーとして左右に送れる。
 * 画像は `ArticleImage` が `data-lightbox-*` を付けて出す。ここでは押された時点の DOM から集める
 */
export function ArticleGallery({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gallery, setGallery] = useState<{ slides: LightboxSlide[]; index: number } | null>(null);

  const open = useCallback((target: EventTarget | null) => {
    const container = containerRef.current;
    if (!container || !(target instanceof Element)) return false;
    const image = target.closest<HTMLImageElement>(IMAGE_SELECTOR);
    if (!image) return false;
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR));
    setGallery({ slides: images.map(readSlide), index: Math.max(images.indexOf(image), 0) });
    return true;
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && open(event.target)) event.preventDefault();
    },
    [open]
  );

  return (
    <div ref={containerRef} onClick={(event) => open(event.target)} onKeyDown={onKeyDown}>
      {children}
      {gallery && (
        <ArticleLightbox slides={gallery.slides} index={gallery.index} close={() => setGallery(null)} />
      )}
    </div>
  );
}

export default ArticleGallery;
