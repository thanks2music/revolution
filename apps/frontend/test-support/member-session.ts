import { createServerClient } from '@supabase/ssr';

import { getLocalSupabaseEnv } from './local-supabase';
import type { TestMember } from './test-data';

/**
 * 会員としてログインした時に、アプリがブラウザに置く cookie を作る。
 *
 * ログインの画面 (メールのワンタイムコード・Google) を毎回たどらずに、E2E が会員の状態から始められるように
 * するため (Playwright の「認証の状態を保存して使い回す」)。
 *
 * cookie の名前・分割・値の符号化は `@supabase/ssr` が決める。自分で組み立てず、アプリの middleware と同じ
 * `createServerClient` にログインさせ、`setAll` に渡された cookie をそのまま受け取る。`@supabase/ssr` を
 * 上げて形式が変わっても、アプリとテストで食い違わない。
 */
export type SessionCookie = { name: string; value: string };

export async function sessionCookiesFor(member: TestMember): Promise<SessionCookie[]> {
  const env = getLocalSupabaseEnv();
  const jar = new Map<string, string>();

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          // 空の値は「この cookie を消す」の指示 (分割の数が減った時など)
          if (value === '') jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  if (error) throw new Error(`会員としてログインできませんでした: ${error.message}`);

  const cookies = [...jar].map(([name, value]) => ({ name, value }));
  if (cookies.length === 0) {
    throw new Error('ログインしましたが、セッションの cookie が書かれませんでした');
  }
  return cookies;
}
