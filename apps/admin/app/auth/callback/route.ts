/**
 * Google ログインの戻り先 (公開サイトの app/auth/callback/route.ts と同じ作り)。
 * 認可コードをセッションに換え、一覧 (または next) へ送る。admin かどうかは proxy (proxy.ts) が見る
 */
import { NextResponse, type NextRequest } from 'next/server';

import { sanitizeNextPath } from '@/lib/auth/safe-redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // プロキシ (Vercel) の後ろでは x-forwarded-host を使う。NEXT_PUBLIC_ADMIN_URL のホストと一致する時だけ
      const forwardedHost = request.headers.get('x-forwarded-host');
      const allowedHost = process.env.NEXT_PUBLIC_ADMIN_URL
        ? new URL(process.env.NEXT_PUBLIC_ADMIN_URL).host
        : null;
      if (process.env.NODE_ENV !== 'development' && forwardedHost && forwardedHost === allowedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
