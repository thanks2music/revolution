'use server';

/**
 * 認証 Server Actions (Crescendolls 会員機能 / M2) — パスワードレス Email OTP
 *
 * - sendOtp: signInWithOtp({ shouldCreateUser: true }) で新規ユーザーを作成可能な
 *   6 桁 OTP メールを送る。
 * - verifyOtp: verifyOtp({ type: 'email' }) で 6 桁を検証しセッションを確立する。
 *
 * Google OAuth は redirect を伴いブラウザ遷移が必要なため Server Action ではなく
 * Client Component (app/login) で signInWithOAuth を呼ぶ (callback で
 * exchangeCodeForSession)。
 *
 * 返り値は表示用の型付き結果 (throw しない設計)。UI 側で error メッセージを出す。
 */

import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const EmailSchema = z.string().email({ message: '有効なメールアドレスを入力してください' });
const OtpTokenSchema = z
  .string()
  .regex(/^\d{6}$/, { message: '6 桁の数字コードを入力してください' });

export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Email OTP を送信する。shouldCreateUser:true で未登録 email も新規作成する。
 */
export async function sendOtp(email: string): Promise<AuthActionResult> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'メールアドレスが不正です' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    return {
      ok: false,
      error: 'コードの送信に失敗しました。時間をおいて再度お試しください。',
    };
  }

  return { ok: true };
}

/**
 * 6 桁 OTP を検証してセッションを確立する。
 */
export async function verifyOtp(
  email: string,
  token: string,
): Promise<AuthActionResult> {
  const parsedEmail = EmailSchema.safeParse(email);
  if (!parsedEmail.success) {
    return { ok: false, error: 'メールアドレスが不正です' };
  }
  const parsedToken = OtpTokenSchema.safeParse(token);
  if (!parsedToken.success) {
    return {
      ok: false,
      error: parsedToken.error.issues[0]?.message ?? 'コードが不正です',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token: parsedToken.data,
    type: 'email',
  });

  if (error) {
    return {
      ok: false,
      error: 'コードが正しくないか期限切れです。もう一度お試しください。',
    };
  }

  return { ok: true };
}

/**
 * ログアウト (マイページ等から呼ぶ。M2 でセッション確認 UX のため最小実装)。
 */
export async function signOut(): Promise<AuthActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, error: 'ログアウトに失敗しました' };
  }
  return { ok: true };
}
