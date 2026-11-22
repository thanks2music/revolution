/**
 * Supabase セッション refresh + 保護境界ヘルパ (Crescendolls 会員機能) — `updateSession`
 *
 * Next.js middleware から呼び出し、Auth セッション (cookie) を refresh しつつ、
 * 保護ルート (`/mypage`, `/onboarding`) の認証境界と onboarding 強制リダイレクトを
 * 適用する。@supabase/ssr 公式の middleware パターンに厳密準拠する。
 *
 * 公式の最重要原則 (絶対に崩さない):
 *   1. `createServerClient` の直後に `getClaims()` / `getUser()` を**間にコードを挟まず**
 *      即時呼び出す。間にロジックを挟むとセッションが意図せず破棄され、ユーザーが
 *      ランダムにログアウトされるデバッグ困難なバグを生む。
 *   2. cookie は request / response 双方に書き戻す (getAll/setAll)。
 *   3. リダイレクトを返す場合も `supabaseResponse` の cookie をコピーする
 *      (cookie 整合性のため。コピーしないと refresh が失われる)。
 *
 * M2 スコープ: ② の認証呼び出し後に ③ 保護判定を追加する。
 *   - `/mypage`, `/onboarding` と口コミの投稿 (`/{種別}/{id}/{開催}/review`) を保護 (他は公開、未認証でも記事を読める)
 *   - 未認証で保護ルート → `/login`
 *   - 認証済みで onboarding 未完了 → `/onboarding` 強制 (案B = JWT claims で判定、
 *     DB を叩かない)
 *   - onboarding 完了済みで `/login` or `/onboarding` 再訪 → `/mypage`
 *
 * 参考: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';
import { isOnboardedFromClaims } from '@/lib/auth/onboarding-status';
import { isReviewSubmitPath, REVIEW_PICKER_PATH } from '@/lib/reviews/paths';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';

// 認証が必要なルート (前方一致)。これ以外はすべて公開 (記事閲覧は維持)。
// /review は口コミを書く開催を選ぶページ (7-0、one-more-time #166)
const PROTECTED_PREFIXES = ['/mypage', '/onboarding', REVIEW_PICKER_PATH];
// 認証関連ページ (完了済みユーザーが再訪したら /mypage へ送る)。
const AUTH_PAGES = ['/login'];


export function isPathProtected(pathname: string): boolean {
  return (
    PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`)) ||
    isReviewSubmitPath(pathname)
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: createServerClient と getClaims() の間にコードを書かない (公式原則)。
  // getClaims() は JWT を検証して claims を返し、必要なら refresh をトリガーする。
  // 案B: onboarding 完了は user_metadata.onboarded (JWT claims) で判定し DB を叩かない。
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  // ③ 保護判定 (getClaims の後、cookie 整合のため supabaseResponse を基にリダイレクト)
  const { pathname } = request.nextUrl;
  const isAuthenticated = !!claims;
  const onboarded = isOnboardedFromClaims(claims);

  // (a) 未認証で保護ルートにアクセス → /login へ (元の遷移先を ?next= で保持)。
  //     return-to は共有サニタイザで安全化した内部パス (外部 URL は /mypage に倒れる)。
  //     login (LoginForm) / callback がこの next を解釈し、ログイン後に元 URL へ戻す。
  if (!isAuthenticated && isPathProtected(pathname)) {
    const returnTo = sanitizeNextPath(`${pathname}${request.nextUrl.search}`);
    return redirectTo(request, supabaseResponse, '/login', returnTo);
  }

  if (isAuthenticated) {
    // 戻り先 (?next=)。onboarding を挟んでも、来た画面へ戻す (one-more-time #166)。
    // 無い・外部の URL は /mypage に倒れる (sanitizeNextPath)
    const requestedNext = request.nextUrl.searchParams.get('next');
    const next = requestedNext ? sanitizeNextPath(requestedNext) : null;

    // (b) 認証済みだが onboarding 未完了 → /onboarding を除く保護ルートで強制誘導 (元の画面を next に)
    if (!onboarded && isPathProtected(pathname) && !pathname.startsWith('/onboarding')) {
      const returnTo = sanitizeNextPath(`${pathname}${request.nextUrl.search}`);
      return redirectTo(request, supabaseResponse, '/onboarding', returnTo);
    }

    // (c) 完了済みで /onboarding 再訪 → 戻り先 (無ければ /mypage) へ
    if (onboarded && pathname.startsWith('/onboarding')) {
      return redirectTo(request, supabaseResponse, next ?? '/mypage');
    }

    // (d) 認証済みで /login (auth ページ) 再訪 → onboarding 状態に応じて誘導 (戻り先は持ち越す)
    if (AUTH_PAGES.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
      return onboarded
        ? redirectTo(request, supabaseResponse, next ?? '/mypage')
        : redirectTo(request, supabaseResponse, '/onboarding', next ?? undefined);
    }
  }

  // IMPORTANT: supabaseResponse をそのまま返す (cookie 整合性のため)。
  return supabaseResponse;
}

/**
 * リダイレクト時も refresh された cookie を失わないよう supabaseResponse の cookie を
 * コピーする (公式パターン: NextResponse.redirect に cookie を引き継ぐ)。
 *
 * @param returnTo 指定時は `?next=<returnTo>` を付与し、ログイン後の return-to を
 *   伝える (未認証→/login のケースのみ使用)。呼び出し側でサニタイズ済みの内部パスを
 *   渡すこと (本関数では encodeURIComponent でクエリ値としてのみ安全化する)。
 */
function redirectTo(
  request: NextRequest,
  supabaseResponse: NextResponse,
  destination: string,
  returnTo?: string
): NextResponse {
  // 行き先は内部のパス。戻り先 (next) をそのまま使う時はクエリも含むので、パスとクエリに分けて当てる
  const target = new URL(destination, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  if (returnTo) {
    url.searchParams.set('next', returnTo);
  }
  const redirectResponse = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach(cookie => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
