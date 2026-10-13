'use client';

import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { SlideImage } from 'yet-another-react-lightbox';

interface ArticleLightboxProps {
  slides: SlideImage[];
  index: number;
  close: () => void;
}

/**
 * 記事の画像の拡大表示 (`ArticleGallery` が押されたときにだけ読み込む)。
 * Zoom: ピンチ・ホイール・ダブルクリックで拡大。Counter: 何枚目か (例: 3 / 11)
 */
export default function ArticleLightbox({ slides, index, close }: ArticleLightboxProps) {
  return (
    <Lightbox
      open
      close={close}
      index={index}
      slides={slides}
      plugins={[Zoom, Counter]}
      zoom={{ maxZoomPixelRatio: 2, scrollToZoom: true }}
      controller={{ closeOnBackdropClick: true }}
    />
  );
}
