/**
 * BOSS のログインの Supabase クライアント (Server Component / Server Action / Route Handler)。
 * admin の DB の関数 (migration 0026) はこのクライアントで呼ぶ (関数の中でも admin を確かめる)。
 * 公開サイトの lib/supabase/server.ts と同じ作り (@supabase/ssr の getAll / setAll)
 */
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からは書けない。セッションの更新は proxy.ts が行う
        }
      },
    },
  });
}
