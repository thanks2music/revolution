/**
 * マイページ (Crescendolls 会員機能 / M3) — 保護ルート
 *
 * middleware が「認証済み + onboarding 完了」を保証する到達点。M3 で M2 の最小版を
 * 発展させ、以下を提供する:
 *   - いいねした記事一覧 (getFavorites + resolveArticleByKey で記事カード表示)
 *   - アカウント管理 (ID / 表示名 / メール / パスワード / ログアウト)
 *   - パスワード未設定時の設定推奨導線
 *
 * 設計:
 * - profiles / favorites は RLS により本人行のみ select 可能。
 * - 記事の逆引きは Layer1 純粋関数 `resolveArticleByKey` + `getAllArticles` (fs) を
 *   Server Component 側で行い、client-safe な記事カードデータだけを渡す。
 * - provider 判定 (hasGoogle/hasEmail = Layer1) で email 変更可否を UI 制御する。
 */

import type { Metadata } from 'next';

import Layout from '@/components/templates/Layout';
import { SectionHeader } from '@/components/molecules/SectionHeader';
import { ArticleCard } from '@/components/molecules/ArticleCard';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/current-user';
import { getFavorites } from '@/actions/favorite';
import { getAllArticles } from '@/lib/mdx/articles';
import { resolveArticleByKey } from '@/lib/mdx/article-url';
import { hasEmail, hasGoogle } from '@/lib/auth/provider';
import type { ArticleIndexItem } from '@/lib/mdx/article-types';
import { AccountManager } from './AccountManager';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = {
  title: 'マイページ — Revolution',
  robots: { index: false, follow: false },
};

export default async function MyPage() {
  const supabase = await createClient();

  // getUser は per-request memoized なヘルパ経由で取得する。同リクエスト内で実行される
  // getFavorites() (actions/favorite.ts) も同じヘルパを使うため、Auth サーバ往復は 1 回に
  // dedup される (Vercel 監査 / React.cache())。
  const {
    data: { user },
  } = await getCachedUser();

  // middleware が保護しているため通常 user は存在するが、防御的に取得する。
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };

  // いいね一覧 → 記事へ逆引き (resolveArticleByKey は Layer1 純粋関数)。
  const favoritesResult = await getFavorites();
  const allArticles = getAllArticles();
  const likedArticles: ArticleIndexItem[] = favoritesResult.ok
    ? favoritesResult.favorites
        .map((f) => resolveArticleByKey(f.targetKey, allArticles))
        .filter((a): a is ArticleIndexItem => a !== null)
    : [];

  // provider 判定 (Layer1)。Google ユーザーはメール変更不可、パスワード設定推奨は
  // メール/Google を問わず未設定なら表示する (Closed Beta の許容範囲)。
  const identities = user?.identities ?? [];
  const userHasEmail = hasEmail(identities);
  const userHasGoogle = hasGoogle(identities);

  return (
    <Layout>
      <section className="w-main mx-auto py-12 md:py-20">
        <SectionHeader
          eyebrow="Account"
          title="マイページ"
          subtitle="プロフィールの編集と、いいねした記事を確認できます。"
        />

        {/* いいね一覧 */}
        <div className="mt-12">
          <h2 className="font-display text-xl text-ink-strong md:text-2xl">
            いいねした記事
            {favoritesResult.ok && (
              <span className="font-numeric ml-2 text-sm text-ink-muted tabular-nums">
                {likedArticles.length}
              </span>
            )}
          </h2>
          {likedArticles.length > 0 ? (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2">
              {likedArticles.map((article) => (
                <li key={article.filePath}>
                  <ArticleCard article={article} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 max-w-prose border-l-[3px] border-[var(--line-soft)] bg-bg-tinted px-5 py-4 text-sm leading-relaxed text-ink-body">
              まだいいねした記事はありません。気になる記事の「いいね」ボタンを押すと、ここに集まります。
            </p>
          )}
        </div>

        {/* アカウント管理 */}
        <div className="mt-16">
          <h2 className="font-display text-xl text-ink-strong md:text-2xl">
            アカウント管理
          </h2>
          <AccountManager
            currentUsername={profile?.username ?? ''}
            currentDisplayName={profile?.display_name ?? ''}
            currentEmail={user?.email ?? ''}
            canChangeEmail={userHasEmail}
            hasGoogle={userHasGoogle}
          />

          <div className="mt-10 border-t border-[var(--line-soft)] pt-8">
            <SignOutButton />
          </div>
        </div>
      </section>
    </Layout>
  );
}
