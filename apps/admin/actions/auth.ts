'use server';

/**
 * 管理アプリのログイン (Figma F-1・F-2)。メールのワンタイムコードと Google (Google はブラウザから
 * 始める: app/login/LoginForm.tsx)。新規登録はさせない (shouldCreateUser: false。管理者しか使わない)。
 * 結果は型付きで返し、throw しない (公開サイトの actions/auth.ts と同じ作り)
 */
import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const EmailSchema = z.string().email();
const CodeSchema = z.string().regex(/^\d{6}$/);

export type AuthResult = { ok: true } | { ok: false; error: string };

export async function sendCode(email: string): Promise<AuthResult> {
  const parsed = EmailSchema.safeParse(email.trim());
  if (!parsed.success) return { ok: false, error: '有効なメールアドレスを入力してください' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false },
  });
  // 登録の無いメールでも同じ表示にする (管理者のメールかどうかを外から確かめられないように)
  if (error && error.status !== 400 && error.status !== 422) {
    Sentry.captureException(error, { tags: { action: 'admin.signInWithOtp' } });
    return { ok: false, error: 'コードの送信に失敗しました。時間をおいてもう一度お試しください。' };
  }
  return { ok: true };
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  const parsedEmail = EmailSchema.safeParse(email.trim());
  const parsedCode = CodeSchema.safeParse(code.trim());
  if (!parsedEmail.success) return { ok: false, error: 'メールアドレスが不正です' };
  if (!parsedCode.success) return { ok: false, error: '6 桁の数字を入力してください' };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token: parsedCode.data,
    type: 'email',
  });
  // 打ち間違い・期限切れは日常的に起きるので Sentry には送らない
  if (error) return { ok: false, error: 'コードが正しくないか、期限が切れています。' };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) Sentry.captureException(error, { tags: { action: 'admin.signOut' } });
  redirect('/login');
}
