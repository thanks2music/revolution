/**
 * 管理アプリの入口 (one-more-time #167)。
 *
 * - ログインしていなければ /login へ (戻り先を ?next= で持つ)
 * - ログインしていて admin の印が無ければ /forbidden へ (Figma F-3)
 * - admin が /login を開いたら一覧へ
 *
 * Supabase のセッションの更新は、公開サイトの lib/supabase/middleware.ts と同じ公式の作り
 * (createServerClient の直後に getClaims、cookie は request と response の両方に書き戻す)。
 * ここは入口の確認で、DB の関数とページ (getAdminSession) でも確かめる
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { isAdminClaims } from '@/lib/auth/claims';
import { sanitizeNextPath } from '@/lib/auth/safe-redirect';

const PUBLIC_PATHS = ['/login', '/auth/callback'];
const FORBIDDEN_PATH = '/forbidden';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  // IMPORTANT: createServerClient と getClaims の間にコードを書かない (公式の原則)
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));

  if (!claims) {
    if (isPublic) return response;
    return redirectTo(request, response, '/login', sanitizeNextPath(`${pathname}${search}`));
  }
  const admin = isAdminClaims(claims);
  // admin でない会員もログインの画面と callback には通す (別のアカウントでログインし直せるように。
  // callback を止めると、新しいコードが交換されず古いセッションのまま /forbidden に戻り続ける)
  if (!admin && !isPublic && pathname !== FORBIDDEN_PATH) {
    return redirectTo(request, response, FORBIDDEN_PATH);
  }
  if (admin && (pathname === '/login' || pathname === FORBIDDEN_PATH)) {
    const next = request.nextUrl.searchParams.get('next');
    return redirectTo(request, response, next ? sanitizeNextPath(next) : '/');
  }
  return response;
}

/** リダイレクトでも、更新したセッションの cookie を引き継ぐ (公式の作り) */
function redirectTo(
  request: NextRequest,
  response: NextResponse,
  destination: string,
  returnTo?: string
): NextResponse {
  const target = new URL(destination, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  if (returnTo && returnTo !== '/') url.searchParams.set('next', returnTo);
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  // 静的なファイル・画像・開発用の写真の出入り口は通さない
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/dev/).*)'],
};
