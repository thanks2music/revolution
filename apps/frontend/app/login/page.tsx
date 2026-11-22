/**
 * ログインページ (Crescendolls 会員機能 / M2)
 *
 * 公開ルート (matcher 内だが middleware の保護対象ではない)。ただし middleware は
 * 認証済みユーザーが /login を再訪した場合に onboarding 状態に応じて /mypage or
 * /onboarding へリダイレクトする (二重防御として保護判定は middleware が担う)。
 */

import type { Metadata } from 'next';

import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { isReviewWritingPath } from '@/lib/reviews/paths';
import Layout from '@/components/templates/Layout';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'ログイン / 登録',
  description:
    'パスワード不要。メールに届く 6 桁コード、または Google でアニイベにログインできます。',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  // open redirect 防止: 共有サニタイザ (lib/auth/safe-redirect) で安全な内部パスのみ
  // 許可する。不正値 (protocol-relative / backslash / 二重エンコード / 外部 URL) は
  // すべて /mypage にフォールバック。callback / LoginForm と同一ロジックを共有する。
  const safeNext = sanitizeNextPath(next ?? null);

  return (
    <Layout>
      <section className="w-main mx-auto flex min-h-[60vh] items-center justify-center py-12 md:py-20">
        <div className="flex w-full max-w-md flex-col gap-4">
          {/* 口コミを書きに来た人には、来た理由を出す (ログインの後にその画面へ戻る。one-more-time #166) */}
          {isReviewWritingPath(safeNext) && (
            <p
              role="status"
              className="rounded-xl border border-(--line-soft) bg-white p-3 text-sm text-ink-body"
            >
              口コミを書くには、ログインしてください。ログインの後に、元の画面へ戻ります。
            </p>
          )}
          <LoginForm initialError={error} next={safeNext} />
        </div>
      </section>
    </Layout>
  );
}
