/**
 * 記事の画像を MDX に書く形 (2026-10-13)
 *
 * `<ArticleImage src="…" alt="…" width="…" height="…" />` (Frontend の `components/molecules/ArticleImage.tsx`)。
 * - 寸法を書くので、Frontend は画像を取りに行かずに「元の幅と記事の幅の小さい方」で出せる
 * - 属性は文字列で書く (`width={800}` の式は、next-mdx-remote 6 が既定の blockJS で取り除くため)
 * - Markdown の `![alt](src)` や小文字の `<img>` を使わないのは、寸法を渡せないため / MDX の components が効かないため
 * - 縦長の画像を分割した片は `part="first|middle|last"` を付け、Frontend が隙間なくつなげて出す
 */
import type { ArticleImageRef } from './upload-article-images';

/**
 * 属性の値に入れられる形にする (& を文字参照に、二重引用符を全角に、改行を空白に)。
 * MDX は属性の値の文字参照を解釈するので (`&copy;` が © になる)、& はそのまま書けない
 */
function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '＂').replace(/\s+/g, ' ').trim();
}

export function articleImageTag(ref: ArticleImageRef, alt: string, part?: 'first' | 'middle' | 'last'): string {
  const partAttr = part ? ` part="${part}"` : '';
  return `<ArticleImage src="${attribute(ref.url)}" alt="${attribute(alt)}" width="${ref.width}" height="${ref.height}"${partAttr} />`;
}

/** 1 枚の画像 (分割した片を含む) を書く。片が複数なら、続けて 1 枚に見えるよう part を付ける */
export function articleImageTags(segments: ArticleImageRef[], alt: string): string {
  if (segments.length === 1) return articleImageTag(segments[0], alt);
  return segments
    .map((segment, index) =>
      articleImageTag(
        segment,
        `${alt} (${index + 1}/${segments.length})`,
        index === 0 ? 'first' : index === segments.length - 1 ? 'last' : 'middle'
      )
    )
    .join('\n\n');
}
