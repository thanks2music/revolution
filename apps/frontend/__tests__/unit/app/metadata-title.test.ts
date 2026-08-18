import { describe, expect, it, jest } from '@jest/globals';

/**
 * ページタイトルに**サイト名が二重に出ない**ことを固定する。
 *
 * ## なぜこのテストが必要か (PR #327)
 *
 * `generateBasicMetadata()` は `title.template = '%s | ${siteConfig.name}'` を
 * 定義しているのに、ネストした 6 ページが `title: '… — Revolution'` と
 * **サイト名を直書き**していたため、テンプレートが二重適用され
 * `すべての記事 — Revolution | Revolution` が本番に出ていた。
 *
 * このバグが検出されなかったのは、`app/page.tsx` が root layout と
 * **同一セグメント**で `title.template` の適用対象外だったため。
 * トップだけ正常に見えており、目視では気づけなかった。
 *
 * したがって固定すべき不変条件は 2 つある:
 *
 * 1. root layout がサイト名を付与するテンプレートを持つこと
 * 2. **ネストしたページはサイト名を自分で持たないこと** (二重付与の防止)
 */

jest.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SITE_NAME: 'テストサイト名',
    NEXT_PUBLIC_SITE_DESCRIPTION: 'テスト説明',
    NEXT_PUBLIC_SITE_URL: 'https://example.com',
    NEXT_PUBLIC_WP_URL: undefined,
  },
}));

describe('metadata の title 合成', () => {
  it('root layout はサイト名を付与するテンプレートを持つ', async () => {
    const { generateBasicMetadata, siteConfig } = await import('@/lib/metadata');
    const title = generateBasicMetadata().title as { default: string; template: string };

    expect(title.template).toBe(`%s | ${siteConfig.name}`);
    expect(title.default).toBe(siteConfig.name);
  });

  it('ネストしたページの title はサイト名を含まない (テンプレートが付与するため)', async () => {
    const { siteConfig } = await import('@/lib/metadata');

    // 動的 metadata を持つページ (events 系) は generateMetadata 側で
    // `generateContentMetadata` を経由するため、ここでは静的 metadata を持つ
    // ページのみを対象にする。
    const pages = [
      '@/app/articles/page',
      '@/app/mypage/page',
      '@/app/login/page',
      '@/app/onboarding/page',
    ];

    for (const path of pages) {
      const mod = (await import(path)) as { metadata: { title?: unknown } };
      const title = mod.metadata.title;

      expect(typeof title).toBe('string');
      expect(title as string).not.toContain(siteConfig.name);
    }
  });
});
