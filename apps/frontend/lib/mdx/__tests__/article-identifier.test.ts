/**
 * Layer1: 記事 URL といいね識別子 (getArticleUrl / buildArticleKey / resolveArticleByKey)
 *
 * ## 2026-08-14 の URL 移行を反映
 *
 * 旧設計は `/{event_type}/{work_slug}/{slug}` の 3 セグメント + レガシー
 * `articles/{slug}` フォールバックの 2 系統だった。**移行後は
 * `/articles/{post_id}` の 1 本のみ**で、`event_type` / `work_slug` は
 * URL にもキーにも現れない。
 *
 * 純粋関数のため I/O を持たず、記事配列はテスト内で組み立てる。
 */

import { buildArticleKey, getArticleUrl, resolveArticleByKey } from '@/lib/mdx/article-url';
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

describe('getArticleUrl', () => {
  it('always builds /articles/{slug}', () => {
    expect(getArticleUrl(makeArticle({ slug: '01jcxy4567znp2f5' }))).toBe(
      '/articles/01jcxy4567znp2f5',
    );
  });

  it('ignores event_type and work_slug (they are no longer part of the URL)', () => {
    // 旧設計ではこれが `/collabo-cafe/kusuriyanohitorigoto/abc` になっていた。
    const article = makeArticle({
      slug: 'abc',
      event_type: 'collabo-cafe',
      work_slug: 'kusuriyanohitorigoto',
    });
    expect(getArticleUrl(article)).toBe('/articles/abc');
  });
});

describe('buildArticleKey', () => {
  it('always builds articles/{slug}', () => {
    expect(buildArticleKey(makeArticle({ slug: 'abc' }))).toBe('articles/abc');
  });

  it('ignores event_type and work_slug', () => {
    const article = makeArticle({
      slug: 'abc',
      event_type: 'pop-up-store',
      work_slug: 'chainsaw-man',
    });
    expect(buildArticleKey(article)).toBe('articles/abc');
  });

  it('stays equal to getArticleUrl minus the leading slash', () => {
    // URL とキーを 1 つの正規化ルールに集約する、という設計意図の維持を固定する。
    const article = makeArticle({ slug: 'abc', event_type: 'collabo-cafe', work_slug: 'w' });
    expect(`/${buildArticleKey(article)}`).toBe(getArticleUrl(article));
  });
});

describe('resolveArticleByKey', () => {
  const a = makeArticle({ slug: 'aaa', filePath: 'a/aaa.mdx' });
  const b = makeArticle({ slug: 'bbb', filePath: 'b/bbb.mdx' });
  const articles = [a, b];

  it('resolves an article by its key', () => {
    expect(resolveArticleByKey(buildArticleKey(a), articles)).toBe(a);
    expect(resolveArticleByKey('articles/bbb', articles)).toBe(b);
  });

  it('returns null for an unknown key', () => {
    expect(resolveArticleByKey('articles/does-not-exist', articles)).toBeNull();
  });

  it('returns null for an empty key', () => {
    expect(resolveArticleByKey('', articles)).toBeNull();
  });

  it('returns null for a bare slug without the namespace prefix', () => {
    // `target_type` があるので `articles/` は冗長だが、現時点では形式の一部。
    // opaque key 化 (別フィーチャー) で外す予定。
    expect(resolveArticleByKey('aaa', articles)).toBeNull();
  });

  it('returns null for an old 3-segment key', () => {
    // 旧形式のキーは `favorites` に 1 件も存在しない (staging/production とも 0 件を実測)
    // ため、解決できないことを仕様として固定する。
    expect(resolveArticleByKey('collabo-cafe/work-a/aaa', articles)).toBeNull();
  });

  /**
   * ★ **`slug` の一意性がここで耐荷重になった**ことを明示するテスト。
   *
   * 旧設計は URL とキーに `event_type` / `work_slug` を含めていたため、
   * 「slug 単独はグローバル一意でない (path 配下のみ一意)」という前提で成立していた。
   * 旧テストには *同じ slug を別 work で持つ 2 記事を区別する* ケースがあった。
   *
   * URL が `/articles/{slug}` の 1 本になった今、**同じ slug の 2 記事は同じ URL /
   * 同じキーになり、区別できない**。つまり `slug` (= `post_id`) の一意性が
   * URL の一意性そのものになった。
   *
   * だからこそ本 PR は `post_id` の衝突除去 (ULID のランダム部を復活させる) を
   * 同梱している。**片方だけ入れると、同一ミリ秒に生成された 2 記事が同じ URL を
   * 持ち、いいねも混ざる。**
   *
   * 経緯: `one-more-time/docs/schema/favorites-opaque-key-plan.md` §2
   */
  it('cannot distinguish two articles sharing a slug (slug uniqueness is now load-bearing)', () => {
    const dup1 = makeArticle({ slug: 'dup', work_slug: 'work-a', filePath: 'a/dup.mdx' });
    const dup2 = makeArticle({ slug: 'dup', work_slug: 'work-b', filePath: 'b/dup.mdx' });

    // 2 記事のキーが同一になる = 区別できない。
    expect(buildArticleKey(dup1)).toBe(buildArticleKey(dup2));

    // 逆引きは先に見つかった方を返すだけ。これは実装の欠陥ではなく、
    // 「slug は一意である」という前提に依存している、という事実。
    expect(resolveArticleByKey('articles/dup', [dup1, dup2])).toBe(dup1);
  });
});
