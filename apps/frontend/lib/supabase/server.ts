/**
 * Supabase サーバークライアント (Crescendolls 会員機能)
 *
 * Server Component / Server Action / Route Handler で使用する。
 * @supabase/ssr 公式の `createServerClient` + cookie getAll/setAll パターン。
 *
 * Next.js 16 (App Router) では `cookies()` が非同期のため、本関数も async。
 *
 * 注意 (公式仕様):
 * - Server Component から呼ぶと cookie の書き込みはできない (setAll の catch で握りつぶす)。
 *   セッション refresh は middleware が行うため、Server Component での書き込み不能は許容。
 * - getAll/setAll は新 API。get/set/remove は deprecated。
 *
 * 参考: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component から呼ばれた場合は cookie を書き込めない。
            // middleware がセッションを refresh するため、ここでの失敗は無害。
          }
        },
      },
    },
  );
}
