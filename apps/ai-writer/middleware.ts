import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decodeJwt } from 'jose';

/**
 * Lightweight JWT validation for Edge Runtime
 * - Checks token structure and basic claims (exp, aud, iss)
 * - Does NOT verify signature (full verification happens in API routes)
 */
function validateJwtBasic(token: string): { valid: boolean; reason?: string } {
  try {
    const decoded = decodeJwt(token);

    // Check expiration
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      return { valid: false, reason: 'Token expired' };
    }

    // Check issuer (Firebase tokens) - exact match required
    const expectedIssuer = `https://securetoken.google.com/${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 't4v-revo-prd'}`;
    if (decoded.iss !== expectedIssuer) {
      return { valid: false, reason: 'Invalid issuer' };
    }

    // Check audience (must match Firebase project ID exactly)
    const expectedAudience = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 't4v-revo-prd';
    if (decoded.aud !== expectedAudience) {
      return { valid: false, reason: 'Invalid audience' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: 'Invalid token format' };
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 🚨 開発環境判定を厳格化
  // - NODE_ENV === 'development' であること
  // - かつ localhost または 127.0.0.1 からのアクセスであること
  // - かつ BYPASS_AUTH_FOR_DEV が明示的に 'true' に設定されていること
  const isDevelopment =
    process.env.NODE_ENV === 'development' &&
    (request.headers.get('host')?.includes('localhost') ||
     request.headers.get('host')?.includes('127.0.0.1')) &&
    process.env.BYPASS_AUTH_FOR_DEV === 'true';

  // 開発環境バイパス（厳格な条件をすべて満たす場合のみ）
  if (isDevelopment) {
    console.log('[Middleware] Development mode with auth bypass enabled');

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

  // /loginページへのアクセス
  if (pathname === '/login') {
    if (authToken) {
      const validation = validateJwtBasic(authToken.value);
      if (validation.valid) {
        // 有効なトークンがある場合はトップへリダイレクト
        return NextResponse.redirect(new URL('/', request.url));
      } else {
        // 無効なトークンの場合はクリアしてログインページを表示
        console.log('[Middleware] Invalid token on login page:', validation.reason);
        const response = NextResponse.next();
        response.cookies.delete('auth-token');
        return response;
      }
    }
    return NextResponse.next();
  }

  // 保護されたページへのアクセス
  if (!authToken) {
    console.log('[Middleware] No auth token, redirecting to login');
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // トークンの基本検証
  const validation = validateJwtBasic(authToken.value);
  if (!validation.valid) {
    console.log('[Middleware] Token validation failed:', validation.reason);
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('auth-token');
    return response;
  }

  // 基本検証OK → 次へ進む（完全な検証はAPI routesで実施）
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};