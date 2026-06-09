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

import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // open redirect 防止: 共有サニタイザ (lib/auth/safe-redirect) で安全な内部パスのみ
  // 許可する。protocol-relative (`//host`) / backslash (`/\host`) / 二重エンコード
  // (`%5C` `%2F%2F`) / 外部 URL はすべて `/mypage` にフォールバックする。
  // login ページ (app/login/page.tsx) / LoginForm と同一ロジックを共有しドリフトを防ぐ。
  const next = sanitizeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      // defense-in-depth: x-forwarded-host は信頼境界の外から注入されうる
      // (誤設定プロキシ / edge 前段への直接リクエスト)。NEXT_PUBLIC_SITE_URL から
      // 導出した許可ホストと一致するときのみ採用し、それ以外は origin (リクエスト
      // 自身の同一オリジン = 安全) にフォールバックする。preview デプロイ
      // (site URL と host が異なる) でも origin フォールバックで正しく動く。
      const allowedHost = process.env.NEXT_PUBLIC_SITE_URL
        ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host
        : null;

      // 本番でプロキシ配下 (forwardedHost あり) なのに許可ホストを導出できない =
      // NEXT_PUBLIC_SITE_URL 未設定。安全に origin へフォールバックするが、配線ミスを
      // 黙殺しないよう警告を出す (claude[bot] review)。
      if (!isLocalEnv && forwardedHost && !allowedHost) {
        console.warn(
          '[auth/callback] NEXT_PUBLIC_SITE_URL 未設定のため x-forwarded-host を検証できず origin にフォールバックします。本番では NEXT_PUBLIC_SITE_URL を設定してください。',
        );
      }

      if (isLocalEnv) {
        // 開発環境: ロードバランサがないため origin をそのまま使う
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost && allowedHost && forwardedHost === allowedHost) {
        // 本番 (プロキシ配下): 許可ホストと一致する x-forwarded-host のみ採用 (https 固定)
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // コード欠落 or 交換失敗 → ログインへエラー表示付きで戻す
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
