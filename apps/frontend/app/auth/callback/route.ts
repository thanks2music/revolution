/**
 * OAuth callback Route Handler (Crescendolls 会員機能 / M2)
 *
 * Google OAuth (signInWithOAuth) の redirectTo に指定する。Supabase は認可コードを
 * `?code=...` で返すため、ここで exchangeCodeForSession を呼びセッション cookie を
 * 確立する。
 *
 * `x-forwarded-host` 対応 (Supabase 公式パターン):
 *   ロードバランサ / プロキシ (Vercel 等) 配下では origin がプロキシのホストを指す
 *   ため、本番では x-forwarded-host を優先して最終リダイレクト URL を組み立てる。
 *
 * セッション確立後の遷移先は middleware が onboarding 状態に応じて再誘導するため、
 * ここでは `next` (既定 `/mypage`) へ送る。未完了ユーザーは middleware が
 * `/onboarding` へ強制リダイレクトする。
 *
 * 参考: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // open redirect 防止: 先頭が単一 `/` で始まる相対パスのみ許可 (`//host` /
  // protocol-relative は拒否)。login ページ (app/login/page.tsx) と同一の厳格ガード
  // に揃える (`startsWith('/')` だと `//attacker.com` を許してしまうため)。
  const nextParam = searchParams.get('next');
  const next = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : '/mypage';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      if (isLocalEnv) {
        // 開発環境: ロードバランサがないため origin をそのまま使う
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        // 本番 (プロキシ配下): x-forwarded-host を優先 (https 固定)
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // コード欠落 or 交換失敗 → ログインへエラー表示付きで戻す
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
