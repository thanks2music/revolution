/**
 * 口コミを書く開催を選ぶ `/review` (7-0、Figma `93:130`、one-more-time #166)。下の「投稿」タブから来る。
 *
 * - ログインと onboarding が要る (`lib/supabase/middleware.ts`)。未ログインならログインの後にこの画面へ戻る
 * - 作品名・企画名・会場名で探す (`?q=`)。選べるのは確認済みで、開催中か終了した開催だけ
 * - 最近見た開催 (ブラウザに残した物) と、口コミを書いた開催 (直す) を並べる
 */

import * as Sentry from '@sentry/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  RecentReviewTargets,
  TargetSection,
} from '@/components/molecules/reviews/RecentReviewTargets';
import Layout from '@/components/templates/Layout';
import { getCurrentMember, memberRedirect } from '@/lib/auth/member';
import { listOwnReviews } from '@/lib/reviews/own-reviews';
import { REVIEW_PICKER_PATH } from '@/lib/reviews/paths';
import {
  MAX_QUERY_LENGTH,
  normalizeQuery,
  searchReviewTargets,
  type ReviewTarget,
} from '@/lib/reviews/picker';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = {
  title: '口コミを書く開催',
  robots: { index: false, follow: false },
};

export default async function ReviewPickerPage(props: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeQuery((await props.searchParams).q);
  // middleware も止めるが、検索は service role を使うので、ページでも会員かを先に確かめる
  const member = await getCurrentMember();
  if (!member.ok) {
    const returnTo = query
      ? `${REVIEW_PICKER_PATH}?q=${encodeURIComponent(query)}`
      : REVIEW_PICKER_PATH;
    redirect(`/${memberRedirect(member.reason)}?next=${encodeURIComponent(returnTo)}`);
  }
  const [results, ownTargets] = await Promise.all([
    query ? searchReviewTargets(query).catch(reportAndEmpty) : Promise.resolve(null),
    loadOwnTargets(member.profileId),
  ]);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-md px-4 py-section-sp md:py-section-pc">
        <header className="relative mb-4 flex items-center justify-center">
          <Link href="/" aria-label="閉じる" className="absolute left-0 text-xl text-ink-muted">
            ×
          </Link>
          <h1 className="font-display text-lg font-bold text-ink-strong">口コミを書く開催</h1>
        </header>

        <form role="search" action="/review" className="mb-3">
          <label htmlFor="review-target-query" className="sr-only">
            作品名・会場名で探す
          </label>
          <input
            id="review-target-query"
            type="search"
            name="q"
            defaultValue={query ?? ''}
            placeholder="作品名・会場名で探す"
            maxLength={MAX_QUERY_LENGTH}
            className="w-full rounded-xl border border-(--line-soft) bg-muted/40 px-4 py-3 text-sm text-ink-strong placeholder:text-ink-muted"
          />
        </form>
        <p className="text-xs text-ink-body">
          行った開催を選んでください。終わった開催にも書けます。
        </p>

        {results && <SearchResults query={query!} results={results} />}

        <RecentReviewTargets excludeIds={ownTargets.map(target => target.occurrenceId)} />
        {ownTargets.length > 0 && (
          <TargetSection title="口コミを書いた開催" targets={ownTargets} ownReview />
        )}
      </div>
    </Layout>
  );
}

function SearchResults({ query, results }: { query: string; results: ReviewTarget[] }) {
  if (results.length === 0) {
    return (
      <p
        data-testid="review-search-empty"
        className="mt-4 rounded-xl border border-(--line-soft) bg-white p-4 text-center text-sm text-ink-body"
      >
        「{query}」に合う開催はありません。作品名や会場名を短くして探してみてください。
      </p>
    );
  }
  return <TargetSection title="探した結果" targets={results} />;
}

function reportAndEmpty(error: unknown): ReviewTarget[] {
  Sentry.captureException(error, { tags: { page: 'review-picker' } });
  return [];
}

/**
 * 会員が口コミを書いた開催 (直す入口)。下書きも含める。理由と訪問日を含む行なので service role で読む。
 * 読めない時は出さない (ページの残りは使える)
 */
async function loadOwnTargets(profileId: string): Promise<ReviewTarget[]> {
  try {
    const admin = createAdminClient();
    if (!admin) return [];
    return (await listOwnReviews(admin, profileId)).map(review => review.target);
  } catch (error) {
    Sentry.captureException(error, { tags: { page: 'review-picker', part: 'own-reviews' } });
    return [];
  }
}
