/**
 * Next.js Middleware
 * - HTTPS強制リダイレクト（本番環境のみ・Supabase クライアント生成の前で早期 return）
 * - Supabase Auth セッション refresh（updateSession、dev でも実行）
 *
 * 順序（@supabase/ssr 公式原則 + 既存 HTTPS 挙動の共存）:
 *   ① 本番のみ HTTPS リダイレクト（createServerClient の前で早期 return）
 *   ② updateSession 内で createServerClient ↔ getUser() を即時呼び出し（cookie refresh）
 *   ③ 保護判定（M0 では無し。M2 で updateSession 内に追加）
 *   → supabaseResponse を return
 *
 * 注意: 既存の「開発環境で全スキップ」挙動は廃止し、cookie refresh は dev でも
 * 実行する。HTTPS リダイレクトは引き続き本番のみ。
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // ① HTTPSリダイレクト（本番環境のみ・Supabase クライアント生成の前で早期 return）
  //    リバースプロキシ（Vercel等）配下では x-forwarded-proto ヘッダーを使用
  if (process.env.NODE_ENV === 'production') {
    const requestUrl = new URL(request.url);
    const proto =
      request.headers.get('x-forwarded-proto') ||
      requestUrl.protocol.replace(':', '');

    // HTTPアクセスの場合、HTTPSにリダイレクト
    if (proto === 'http') {
      const httpsUrl = new URL(request.url);
      httpsUrl.protocol = 'https:';

      return NextResponse.redirect(httpsUrl, {
        status: 301, // Permanent redirect
      });
    }
  }

  // ② Supabase Auth セッション refresh（dev でも実行）
  //    ③ 保護判定は M0 では行わない（updateSession 内に M2 で追加）
  return await updateSession(request);
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
