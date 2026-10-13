/**
 * Layer 1: 記事の画像の MDX の書き方 (`article-image-tag.ts`、2026-10-13)。
 */
import { articleImageTag, articleImageTags } from '@/lib/services/article-images/article-image-tag';

const ref = (n: number, height = 800) => ({ url: `https://images.example.com/f/${n}.webp`, width: 1600, height });

describe('articleImageTag', () => {
  it('寸法を文字列の属性で書く (next-mdx-remote の blockJS が式を取り除くため)', () => {
    expect(articleImageTag(ref(1), 'マルゲリータ')).toBe(
      '<ArticleImage src="https://images.example.com/f/1.webp" alt="マルゲリータ" width="1600" height="800" />'
    );
  });

  it('代替テキストの二重引用符は全角に、改行は空白にする', () => {
    expect(articleImageTag(ref(1), '"限定"\nドリンク')).toContain('alt="＂限定＂ ドリンク"');
  });
});

describe('articleImageTags', () => {
  it('1 片ならそのまま', () => {
    expect(articleImageTags([ref(1)], 'a')).toBe(articleImageTag(ref(1), 'a'));
  });

  it('分割した片は (i/n) と part を付け、空行でつなぐ', () => {
    expect(articleImageTags([ref(1, 4800), ref(2, 4800), ref(3, 400)], 'メニュー').split('\n\n')).toEqual([
      articleImageTag(ref(1, 4800), 'メニュー (1/3)', 'first'),
      articleImageTag(ref(2, 4800), 'メニュー (2/3)', 'middle'),
      articleImageTag(ref(3, 400), 'メニュー (3/3)', 'last'),
    ]);
  });
});
