/**
 * Supabase 管理クライアント (Crescendolls 会員機能 / M4) — RLS バイパス
 *
 * `SUPABASE_SECRET_KEY` (modern secret key) を使い RLS をバイパスする **server-only**
 * クライアント。secret key を参照するため、必ず `'use server'` の Server Action か
 * Server Component からのみ import すること (Client Component から import すると
 * secret key がバンドルに混入する)。
 *
 * 用途は、本人のセッションでは RLS で読めない・書けない物に限る: username の可用性チェック
 * (他人の行の存在確認)、口コミの審査の結果の書き込み、本人に理由や日付を見せる読み取り、
 * 通報の受け付け (`submit_review_report` は service role にだけ渡してある) など。
 * 本人の操作で済む物は、RLS が効く @/lib/supabase/server の createClient を使う。
 *
 * cookie/session を持たない (auth state を永続しない) ため、自動 token refresh も無効化。
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * secret key が設定されていれば RLS バイパスの admin クライアントを返す。
 * 未設定 (CI / 一部環境) の場合は null を返し、呼び出し側でフォールバックさせる。
 */
export function createAdminClient() {
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
