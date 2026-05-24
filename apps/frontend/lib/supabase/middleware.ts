/**
 * Supabase セッション refresh ヘルパ (Crescendolls 会員機能) — `updateSession`
 *
 * Next.js middleware から呼び出し、Auth セッション (cookie) を refresh する。
 * @supabase/ssr 公式の middleware パターンに厳密準拠する。
 *
 * 公式の最重要原則 (絶対に崩さない):
 *   1. `createServerClient` の直後に `getClaims()` / `getUser()` を**間にコードを挟まず**
 *      即時呼び出す。間にロジックを挟むとセッションが意図せず破棄され、ユーザーが
 *      ランダムにログアウトされるデバッグ困難なバグを生む。
 *   2. cookie は request / response 双方に書き戻す (getAll/setAll)。
 *   3. `supabaseResponse` をそのまま return する (新しい NextResponse を作らない。
 *      作る場合は cookie をコピーする)。
 *
 * M0 スコープ: ここでは保護判定 (リダイレクト等) を行わない。全ルートを公開のまま、
 * cookie refresh の共存のみを導入する。保護境界は M2 で追加する。
 *
 * 参考: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';

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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: createServerClient と getUser() の間にコードを書かない (公式原則)。
  // getUser() は Auth サーバーへトークンを問い合わせて refresh をトリガーする。
  await supabase.auth.getUser();

  // M0: 保護判定なし。全ルート公開のまま supabaseResponse を返す。
  // M2 で `/mypage` `/onboarding` の保護境界をこの位置 (getUser の後) に追加する。

  // IMPORTANT: supabaseResponse をそのまま返す (cookie 整合性のため)。
  return supabaseResponse;
}
