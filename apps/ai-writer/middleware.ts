import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDevelopment = process.env.NODE_ENV === 'development';

  // 開発環境では認証をバイパス
  if (isDevelopment) {
    console.log('[Middleware] Development mode - bypassing authentication');

    // /loginページにアクセスした場合はトップへリダイレクト
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }

    // 開発用のauth-tokenを自動設定
    const response = NextResponse.next();
    if (!request.cookies.get('auth-token')) {
      response.cookies.set('auth-token', 'dev-token-local', {
        httpOnly: true,
        secure: false, // 開発環境ではfalse
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7 // 7 days
      });
    }
    return response;
  }

  // 本番環境では通常の認証フロー
  const authToken = request.cookies.get('auth-token');

  if (pathname === '/login') {
    if (authToken) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!authToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};