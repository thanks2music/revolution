import { signOut } from '@/actions/auth';
import { AdminBar } from '@/components/AdminBar';
import { createClient } from '@/lib/supabase/server';

/** ログインはできたが admin でない (Figma F-3)。公開サイトへのリンクは出さない */
export default async function ForbiddenPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return (
    <>
      <AdminBar />
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 bg-surface px-4 py-12 text-center sm:mt-8 sm:rounded-2xl sm:border sm:border-line">
        <span aria-hidden className="text-3xl">
          🔒
        </span>
        <h1 className="font-display text-lg font-bold text-ink-strong">
          このアカウントには管理画面の権限がありません
        </h1>
        {data.user?.email && (
          <p className="text-xs text-ink-muted">{data.user.email} でログインしています。</p>
        )}
        <form action={signOut} className="mt-4 w-full">
          <button
            type="submit"
            className="w-full rounded-xl border border-line py-3 text-sm font-bold text-ink-strong hover:bg-surface-subtle"
          >
            ログアウト
          </button>
        </form>
      </main>
    </>
  );
}
