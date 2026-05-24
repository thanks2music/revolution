/**
 * Supabase ブラウザクライアント (Crescendolls 会員機能)
 *
 * Client Component / ブラウザ側でのみ使用する。@supabase/ssr 公式の
 * `createBrowserClient` パターン。
 *
 * 公開キー (publishable key) は `NEXT_PUBLIC_` プレフィックスのため
 * バンドルに含まれてよい（RLS により保護される前提）。
 *
 * 参考: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createBrowserClient } from '@supabase/ssr';

import { env } from '@/lib/env';

export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
