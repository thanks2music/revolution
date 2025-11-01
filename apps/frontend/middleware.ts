/**
 * Next.js Middleware
 * - HTTPS強制リダイレクト（本番環境のみ）
 * - セキュリティ監査ログ（将来の拡張用）
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 開発環境ではミドルウェアをスキップ
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  // HTTPSリダイレクト（本番環境のみ）
  const requestUrl = new URL(request.url);

  // HTTPアクセスの場合、HTTPSにリダイレクト
  if (requestUrl.protocol === 'http:') {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = 'https:';

    return NextResponse.redirect(httpsUrl, {
      status: 301, // Permanent redirect
    });
  }

  // その他のリクエストはそのまま通過
  return NextResponse.next();
}

// ミドルウェアを適用するパスを指定
export const config = {
  // すべてのパスに適用（静的ファイルとAPIルートを除く）
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
