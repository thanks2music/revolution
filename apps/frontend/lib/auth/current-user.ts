/**
 * server-only の認証ユーザー取得ヘルパ (Crescendolls 会員機能 / Vercel 監査 fix)
 *
 * `React.cache()` で `supabase.auth.getUser()` を **1 リクエスト内 1 回** に dedup する。
 *
 * 背景 (Vercel React/Next.js ベストプラクティス監査 / server-cache-react, MEDIUM):
 * - これまで `app/mypage/page.tsx` が `auth.getUser()` を呼び、同リクエストで実行される
 *   `getFavorites()` (actions/favorite.ts) も内部で `getUser()` を呼んでいた。
 *   結果、1 リクエストで Supabase Auth サーバへの往復が重複していた。
 * - `React.cache()` は同一リクエスト内で同じ引数の呼び出しをメモ化する公式の仕組み。
 *   認証チェックは fetch ではない非同期処理 (Auth サーバ往復) のため、Next.js の fetch
 *   メモ化では dedup されず、`React.cache()` が必要。
 *
 * 注意:
 * - 引数なし関数のため cache key は安定 (inline object を渡すと shallow 比較で cache miss
 *   になるが、本関数は引数を取らないためその問題は発生しない)。
 * - RLS 文脈は変えない。createClient (cookie ベースの SSR クライアント) をそのまま使い、
 *   getUser の戻り値 (data.user / error) をそのまま返す。
 * - **server-only 用途**: Server Component (`app/mypage/page.tsx`) と `'use server'` Server
 *   Action (`actions/favorite.ts`) からのみ import する。`server-only` パッケージは Next.js 16
 *   に top-level として同梱されず解決不可のため import せず (lib/supabase/admin.ts と同方針、
 *   依存追加回避 = YAGNI)、本 JSDoc で用途を明記する。`@/lib/supabase/server` (createClient)
 *   が next/headers の cookies を読むため、いずれにせよクライアントからは利用不能。
 *
 * 参考: https://react.dev/reference/react/cache
 */

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * 現在の認証ユーザーを取得する (per-request memoized)。
 *
 * 同一リクエスト内で複数回呼ばれても Supabase Auth への問い合わせは 1 回に dedup される。
 * 戻り値は supabase-js の `auth.getUser()` の結果と同じ `{ data: { user }, error }` 形。
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
