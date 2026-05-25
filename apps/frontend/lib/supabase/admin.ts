/**
 * Supabase 管理クライアント (Crescendolls 会員機能 / M4) — RLS バイパス
 *
 * `SUPABASE_SECRET_KEY` (modern secret key) を使い RLS をバイパスする **server-only**
 * クライアント。secret key を参照するため、必ず `'use server'` の Server Action か
 * Server Component からのみ import すること (Client Component から import すると
 * secret key がバンドルに混入する)。本リポジトリでは `actions/profile.ts`
 * (`'use server'`) からのみ呼ばれる。
 *
 * 用途は限定的: username 可用性チェック (他人行の存在確認) のように、本人セッションでは
 * RLS で他人行が見えず判定できない軽量 read 系のみ。書き込みや本人限定操作には使わない
 * (それらは RLS が効く @/lib/supabase/server の createClient を使う)。
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
