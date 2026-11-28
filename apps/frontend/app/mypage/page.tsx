/**
 * マイページ (Crescendolls 会員機能 / M3) — 保護ルート
 *
 * middleware が「認証済み + onboarding 完了」を保証する到達点。M3 で M2 の最小版を
 * 発展させ、以下を提供する:
 *   - 自分の口コミ (状態・理由・編集と削除の入口。S4 #162、`lib/reviews/own-reviews.ts`)
 *   - いいねした記事一覧 (getFavorites + resolveArticleByKey で記事カード表示)
 *   - プロフィール (画像・表示名・@ID。編集は /mypage/profile、#171)
 *   - アカウント管理 (メール / パスワード / ログアウト)
 *   - パスワード未設定時の設定推奨導線
 *
 * 設計:
 * - profiles / favorites は RLS により本人行のみ select 可能。
 * - 記事の逆引きは Layer1 純粋関数 `resolveArticleByKey` + `getAllArticles` (fs) を
 *   Server Component 側で行い、client-safe な記事カードデータだけを渡す。
 * - provider 判定 (hasGoogle/hasEmail = Layer1) で email 変更可否を UI 制御する。
 */

import * as Sentry from '@sentry/nextjs';
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
import { OwnReviewList } from '@/components/molecules/reviews/OwnReviewList';
import { listOwnReviews, type OwnReviewListItem } from '@/lib/reviews/own-reviews';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';
import { createAdminClient } from '@/lib/supabase/admin';
import { Avatar } from '@/components/molecules/profile/Avatar';
import { loadOwnAvatarState } from '@/lib/profile/own-avatar';
import { AVATAR_REJECT_REASON_LABELS } from '@revolution/schemas/profile-avatar';
import Link from 'next/link';
import { AccountManager } from './AccountManager';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = {
  title: 'マイページ',
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
        .select('id, username, display_name')
        .eq('auth_user_id', user.id)
        .maybeSingle()
    : { data: null };

  // 自分の口コミ・いいね一覧・プロフィール画像は互いに依存しないので、並べて引く
  const [ownReviews, favoritesResult, avatar] = await Promise.all([
    profile ? loadOwnReviews(profile.id as string) : Promise.resolve([]),
    getFavorites(),
    profile ? loadOwnAvatarState(profile.id as string) : Promise.resolve(null),
  ]);
  const displayName = (profile?.display_name as string | null) ?? '';

  // いいね一覧 → 記事へ逆引き (resolveArticleByKey は Layer1 純粋関数)。
  const allArticles = getAllArticles();
  const likedArticles: ArticleIndexItem[] = favoritesResult.ok
    ? favoritesResult.favorites
        .map(f => resolveArticleByKey(f.targetKey, allArticles))
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
          subtitle="自分の口コミ・いいねした記事・プロフィールを確認できます。"
        />

        {/* プロフィール (Figma #12 の上。画像は公開の時だけ、それ以外は頭文字。#171) */}
        <div className="mt-10 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} view={avatar?.view ?? null} size={50} />
            <div className="min-w-0">
              <p className="truncate font-display text-base text-ink-strong">{displayName}</p>
              {profile?.username && (
                <p className="font-numeric text-xs text-ink-muted">@{profile.username as string}</p>
              )}
              <Link
                href="/mypage/profile"
                className="font-display text-xs text-primary-700 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                プロフィールを編集 ›
              </Link>
            </div>
          </div>
          {avatar?.status === 'rejected' && avatar.reasonCode && (
            <p
              role="status"
              className="rounded-[10px] bg-status-cancelled-surface px-3 py-2.5 text-[11px] text-status-cancelled"
            >
              プロフィール画像を表示できませんでした (
              {AVATAR_REJECT_REASON_LABELS[avatar.reasonCode]})。
              「プロフィールを編集」から別の画像を選べます。
            </p>
          )}
        </div>

        {/* 自分の口コミ (Figma #12 `83:191`) */}
        {/* 鍵の無い環境 (Preview など) では、欄そのものを出さない */}
        {ownReviews !== 'unavailable' && (
          <div className="mt-12">
            <h2 className="font-display text-xl text-ink-strong md:text-2xl">
              自分の口コミ
              {ownReviews && (
                <span className="font-numeric ml-2 text-sm text-ink-muted tabular-nums">
                  {ownReviews.length}
                </span>
              )}
            </h2>
            {ownReviews ? (
              <OwnReviewList reviews={ownReviews} />
            ) : (
              <p className="mt-6 text-sm text-ink-muted">
                口コミを読み込めませんでした。時間をおいて、ページを読み込み直してください。
              </p>
            )}
          </div>
        )}

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
              {likedArticles.map(article => (
                <li key={article.filePath}>
                  <ArticleCard article={article} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 max-w-prose border-l-[3px] border-(--line-soft) bg-bg-tinted px-5 py-4 text-sm leading-relaxed text-ink-body">
              まだいいねした記事はありません。気になる記事の「いいね」ボタンを押すと、ここに集まります。
            </p>
          )}
        </div>

        {/* アカウント管理 */}
        <div className="mt-16">
          <h2 className="font-display text-xl text-ink-strong md:text-2xl">アカウント管理</h2>
          {/*
            migration 0011 (M1) 以降、`display_name` / `username` は**退会時に null 化**される
            (PII 匿名化)。ただし退会済みユーザーは認証を通れないため本ページには到達せず、
            ここでの null は「onboarding 未完了」を意味する。`?? ''` のままでよい。

            「退会済みユーザー」という表示が要るのは**他人の名前を出す画面** (レビュー一覧等)
            で、それらは S4 スコープ。現時点で該当画面は存在しないため実装しない (YAGNI)。
          */}
          <AccountManager
            currentEmail={user?.email ?? ''}
            canChangeEmail={userHasEmail}
            hasGoogle={userHasGoogle}
          />

          <div className="mt-10 border-t border-(--line-soft) pt-8">
            <SignOutButton />
          </div>
        </div>
      </section>
    </Layout>
  );
}

/**
 * 会員の口コミ。理由と訪問日は本人にだけ見せる列なので、サーバーが service role で読む
 * (`lib/reviews/own-reviews.ts`)。読めない時は null (「読み込めませんでした」を出し、ページの残りは出す)。
 * service role の鍵が無い環境 (Preview など) では 'unavailable' (欄を出さない。開くたびに Sentry へ送らない)
 */
async function loadOwnReviews(
  profileId: string
): Promise<OwnReviewListItem[] | null | 'unavailable'> {
  try {
    const admin = createAdminClient();
    if (!admin) return 'unavailable';
    return await listOwnReviews(admin, profileId, getReviewPhotoStorage());
  } catch (error) {
    Sentry.captureException(error, { tags: { page: 'mypage' } });
    return null;
  }
}
