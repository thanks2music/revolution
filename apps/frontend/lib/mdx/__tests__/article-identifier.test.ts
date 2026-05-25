/**
 * Layer1: いいね識別子ヘルパ (buildArticleKey / resolveArticleByKey)
 *
 * - buildArticleKey: 記事 → favorites.target_key (URL path 連結キー、先頭スラッシュなし)。
 *   getArticleUrl と同じ正規化ルール (3 セグメント / レガシー articles/{slug})。
 * - resolveArticleByKey: target_key → 記事 (逆引き、3 つ揃いで一意特定、レガシー fallback)。
 *
 * 純粋関数のため I/O を持たず、記事配列はテスト内で組み立てる。
 */

import { buildArticleKey, resolveArticleByKey } from '@/lib/mdx/article-url';
import type { ArticleIndexItem } from '@/lib/mdx/article-types';

function makeArticle(overrides: Partial<ArticleIndexItem>): ArticleIndexItem {
  return {
    slug: 'slug',
    title: 'title',
    date: '2026-01-01T00:00:00.000Z',
    excerpt: '',
    categories: [],
    tags: [],
    author: 'tester',
    filePath: `path/${overrides.slug ?? 'slug'}.mdx`,
    event_type: null,
    work_slug: null,
    ...overrides,
  };
}

describe('buildArticleKey', () => {
  it('builds event_type/work_slug/slug for a normal nested article', () => {
    const article = makeArticle({
      slug: 'dry-run-1',
      event_type: 'collabo-cafe',
      work_slug: 'kusuriyanohitorigoto',
    });
    expect(buildArticleKey(article)).toBe('collabo-cafe/kusuriyanohitorigoto/dry-run-1');
  });

  it('falls back to articles/{slug} when event_type is null', () => {
    const article = makeArticle({ slug: 'legacy-1', event_type: null, work_slug: null });
    expect(buildArticleKey(article)).toBe('articles/legacy-1');
  });

  it("falls back to articles/{slug} when event_type === 'articles'", () => {
    const article = makeArticle({ slug: 'legacy-2', event_type: 'articles', work_slug: 'x' });
    expect(buildArticleKey(article)).toBe('articles/legacy-2');
  });

  it('falls back to articles/{slug} when work_slug is null', () => {
    const article = makeArticle({ slug: 'legacy-3', event_type: 'collabo-cafe', work_slug: null });
    expect(buildArticleKey(article)).toBe('articles/legacy-3');
  });

  it('produces the same string as getArticleUrl minus the leading slash', () => {
    const article = makeArticle({
      slug: 'abc',
      event_type: 'pop-up-store',
      work_slug: 'chainsaw-man',
    });
    // getArticleUrl は /pop-up-store/chainsaw-man/abc を返す
    expect(`/${buildArticleKey(article)}`).toBe('/pop-up-store/chainsaw-man/abc');
  });
});

describe('resolveArticleByKey', () => {
  const nested = makeArticle({
    slug: 'dup',
    event_type: 'collabo-cafe',
    work_slug: 'work-a',
    filePath: 'a/dup.mdx',
  });
  // 同じ slug 'dup' を別 work で持つ記事 (slug 単独一意でないケース)
  const nestedSameSlug = makeArticle({
    slug: 'dup',
    event_type: 'pop-up-store',
    work_slug: 'work-b',
    filePath: 'b/dup.mdx',
  });
  const legacy = makeArticle({
    slug: 'legacy-1',
    event_type: null,
    work_slug: null,
    filePath: 'legacy/legacy-1.mdx',
  });
  const articles = [nested, nestedSameSlug, legacy];

  it('resolves a nested article by its full 3-segment key', () => {
    const key = buildArticleKey(nested);
    expect(resolveArticleByKey(key, articles)).toBe(nested);
  });

  it('distinguishes two articles sharing the same slug (uses full key, not slug alone)', () => {
    expect(resolveArticleByKey(buildArticleKey(nested), articles)).toBe(nested);
    expect(resolveArticleByKey(buildArticleKey(nestedSameSlug), articles)).toBe(nestedSameSlug);
  });

  it('resolves a legacy article by articles/{slug}', () => {
    expect(resolveArticleByKey('articles/legacy-1', articles)).toBe(legacy);
  });

  it('returns null for an unknown key', () => {
    expect(resolveArticleByKey('collabo-cafe/work-a/does-not-exist', articles)).toBeNull();
  });

  it('returns null for an empty key', () => {
    expect(resolveArticleByKey('', articles)).toBeNull();
  });

  it('returns null for a malformed key', () => {
    expect(resolveArticleByKey('just-one-segment', articles)).toBeNull();
  });

  // 回帰 (#3): legacy 形式キー `articles/{slug}` は、同名 slug を持つ非レガシー
  // (nested) 記事へ誤解決してはならない。legacy fallback は「対象記事自身が legacy」の
  // ときだけ slug 一致を許す。
  describe('namespace strictness — legacy key must not cross into nested articles', () => {
    it('does not resolve articles/{slug} to a nested article sharing that slug', () => {
      // nested 記事 (event_type/work_slug あり) が slug 'shared-slug' を持つが、
      // legacy 記事は存在しないケース。
      const nestedOnly = makeArticle({
        slug: 'shared-slug',
        event_type: 'collabo-cafe',
        work_slug: 'work-c',
        filePath: 'c/shared-slug.mdx',
      });
      const pool = [nestedOnly];
      // legacy キー articles/shared-slug は nested 記事へ交差解決せず null。
      expect(resolveArticleByKey('articles/shared-slug', pool)).toBeNull();
    });

    it('resolves articles/{slug} to the legacy article even when a nested article shares the slug', () => {
      // 同名 slug 'collide' を、legacy 記事と nested 記事の両方が持つケース。
      const legacyCollide = makeArticle({
        slug: 'collide',
        event_type: null,
        work_slug: null,
        filePath: 'legacy/collide.mdx',
      });
      const nestedCollide = makeArticle({
        slug: 'collide',
        event_type: 'pop-up-store',
        work_slug: 'work-d',
        filePath: 'd/collide.mdx',
      });
      const pool = [nestedCollide, legacyCollide];
      // legacy キーは legacy 記事に解決する (nested を先に並べても誤らない)。
      expect(resolveArticleByKey('articles/collide', pool)).toBe(legacyCollide);
      // nested キーは nested 記事に解決する (相互に交差しない)。
      expect(resolveArticleByKey(buildArticleKey(nestedCollide), pool)).toBe(
        nestedCollide,
      );
    });

    it("treats event_type==='articles' as legacy for the slug fallback", () => {
      // event_type が 'articles' (work_slug あり) でも buildArticleKey は articles/{slug}
      // を生成する = legacy 扱い。legacy キーで slug 一致解決できる。
      const pseudoLegacy = makeArticle({
        slug: 'pseudo',
        event_type: 'articles',
        work_slug: 'ignored',
        filePath: 'p/pseudo.mdx',
      });
      expect(resolveArticleByKey('articles/pseudo', [pseudoLegacy])).toBe(
        pseudoLegacy,
      );
    });
  });
});
