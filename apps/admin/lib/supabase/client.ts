/** ブラウザの Supabase クライアント (Google ログインの開始だけに使う) */
import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';

export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
