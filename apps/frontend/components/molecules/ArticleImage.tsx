import { toDimensions } from '@/lib/mdx/article-image';
import { ArticleImageView } from '@/components/molecules/ArticleImageView';
import { getImageDimensions } from '@/lib/mdx/image-dimensions';

interface ArticleImageProps {
  src?: string | Blob;
  alt?: string;
  width?: number | string;
  height?: number | string;
  /** 記事の冒頭のアイキャッチなど、最初の画面に出る画像 */
  priority?: boolean;
}

/**
 * 記事の画像 (MDX の `![alt](src)`・`<ArticleImage>`・冒頭のアイキャッチ)。
 *
 * - 「元の幅」と「記事の幅」の小さい方で、縦横比のまま出す。記事の幅より小さい画像は中央に寄せる
 *   (2026-10-13 まで高さ 400px の枠に収めていたため、縦長の画像が幅 40px ほどの帯になっていた)
 * - 寸法は `width`/`height` があればそれを使い、無ければ画像の先頭を読んで得る (`getImageDimensions`)
 * - `data-lightbox-*` は拡大表示 (`ArticleGallery`) が読む
 */
export async function ArticleImage({ src, alt = '', width, height, priority = false }: ArticleImageProps) {
  if (typeof src !== 'string' || !src) return null;

  // 自前の静的ファイルなど、外部の画像でないものはそのまま出す
  if (!src.startsWith('http')) {
    // eslint-disable-next-line @next/next/no-img-element -- 寸法の分からない自前のファイル。2026-10-13 より前の CustomImage と同じ扱い
    return <img src={src} alt={alt} className="mx-auto my-6 block h-auto max-w-full" />;
  }

  const dimensions = toDimensions(width, height) ?? (await getImageDimensions(src));

  return (
    <span className="my-6 block">
      <ArticleImageView src={src} alt={alt} dimensions={dimensions} priority={priority} />
    </span>
  );
}

export default ArticleImage;
