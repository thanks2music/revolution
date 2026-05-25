'use server';

/**
 * アカウント管理 Server Actions (Crescendolls 会員機能 / M3)
 *
 * マイページの「ID (username) 変更 / 表示名変更 / メール変更 / パスワード任意設定」を
 * 担う。M2 の profile.ts (onboarding) と同じ方針で、profiles の更新は RLS が効く
 * Supabase server クライアント経由、user_id は getUser() から取得する。
 *
 * 設計判断:
 * - **username / displayName 変更**: `@revolution/schemas/profile` の zod (真実源, Layer1)
 *   で検証 → profiles.update を本人 id で実行。username 重複は `lower(username)` unique
 *   違反 (23505) を username フィールドエラーに変換 (case-insensitive 一致を含む)。
 * - **メール変更**: 確定仕様で「メール登録ユーザーのみ可、Google ユーザー不可」。
 *   identities を見て email provider を持たないユーザーは拒否する (canChangeEmail, Layer1)。
 *   `updateUser({ email })` は Supabase が確認メールを送る (二重確認)。即時反映ではなく
 *   確認待ちであることを UI に伝える。
 * - **パスワード設定**: 登録時はパスワードを持たない (パスワードレス) ため、後付けで
 *   `updateUser({ password })` を呼ぶ。email verified 前提 (Closed Beta の許容範囲)。
 * - throw せず型付き結果を返す (UI でフィールド別エラー表示)。
 */

import { z } from 'zod';

import { ProfileUpdateSchema } from '@revolution/schemas/profile';

import { canChangeEmail } from '@/lib/auth/provider';
import { createClient } from '@/lib/supabase/server';

const PG_UNIQUE_VIOLATION = '23505';

const EmailSchema = z
  .string()
  .email({ message: '有効なメールアドレスを入力してください' });

// パスワードは Supabase の既定最小長 (6 文字) に合わせつつ、後付け設定の最低限。
const PasswordSchema = z
  .string()
  .min(8, { message: 'パスワードは 8 文字以上で設定してください' })
  .max(72, { message: 'パスワードは 72 文字以内で設定してください' });

export type AccountResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; field?: 'username' | 'displayName' | 'email' | 'password' | 'general' };

/**
 * ユーザー名 (ID) を変更する。case-insensitive unique。
 */
export async function updateUsername(input: { username: string }): Promise<AccountResult> {
  // displayName は同時に検証しないため username のみ pick で検証する。
  const parsed = ProfileUpdateSchema.pick({ username: true }).safeParse({
    username: input.username,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'ユーザー名を確認してください',
      field: 'username',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', field: 'general' };
  }

  // .select() を付けて影響行を取得し、0 行一致 (profiles 行欠落 / RLS で他人行) を
  // 暗黙成功にしない (PostgREST は 0 行 update でも error=null を返すため)。
  const { data, error } = await supabase
    .from('profiles')
    .update({ username: parsed.data.username })
    .eq('id', user.id)
    .select('id');

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: 'このユーザー名は既に使用されています。別の名前をお試しください。',
        field: 'username',
      };
    }
    return {
      ok: false,
      error: '保存に失敗しました。時間をおいて再度お試しください。',
      field: 'general',
    };
  }

  // 影響行 0 = 更新対象 (本人の profiles 行) が無い。成功扱いにしない。
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'ユーザー名を更新できませんでした。時間をおいて再度お試しください。',
      field: 'general',
    };
  }

  return { ok: true, message: 'ユーザー名を変更しました' };
}

/**
 * 表示名を変更する。
 */
export async function updateDisplayName(input: { displayName: string }): Promise<AccountResult> {
  const parsed = ProfileUpdateSchema.pick({ displayName: true }).safeParse({
    displayName: input.displayName,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? '表示名を確認してください',
      field: 'displayName',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', field: 'general' };
  }

  // .select() で影響行を取得し、0 行一致 (profiles 行欠落 / RLS で他人行) を
  // 暗黙成功にしない (PostgREST は 0 行 update でも error=null を返すため)。
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: parsed.data.displayName })
    .eq('id', user.id)
    .select('id');

  if (error) {
    return {
      ok: false,
      error: '保存に失敗しました。時間をおいて再度お試しください。',
      field: 'general',
    };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error: '表示名を更新できませんでした。時間をおいて再度お試しください。',
      field: 'general',
    };
  }

  return { ok: true, message: '表示名を変更しました' };
}

/**
 * メールアドレスを変更する。**メール登録ユーザーのみ可** (Google ユーザー不可)。
 * updateUser({ email }) は Supabase が確認メールを送るため、即時反映ではなく
 * 確認待ちであることを返す。
 */
export async function updateEmail(input: { email: string }): Promise<AccountResult> {
  const parsed = EmailSchema.safeParse(input.email);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'メールアドレスが不正です',
      field: 'email',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', field: 'general' };
  }

  // 確定仕様: Google ユーザーはメール変更不可。サーバ側でも provider を再確認する
  // (UI 側の制御に加えた二重防御。クライアント表示だけに依存しない)。
  if (!canChangeEmail(user.identities)) {
    return {
      ok: false,
      error: 'Google でログインしているアカウントはメールアドレスを変更できません。',
      field: 'email',
    };
  }

  const { error } = await supabase.auth.updateUser({ email: parsed.data });
  if (error) {
    return {
      ok: false,
      error: 'メールアドレスの変更に失敗しました。時間をおいて再度お試しください。',
      field: 'email',
    };
  }

  return {
    ok: true,
    message:
      '新しいメールアドレス宛に確認メールを送信しました。メール内のリンクで確認すると変更が完了します。',
  };
}

/**
 * パスワードを後付けで設定 (または変更) する。パスワードレス登録ユーザーの
 * ロックアウト対策の任意導線。
 */
export async function updatePassword(input: { password: string }): Promise<AccountResult> {
  const parsed = PasswordSchema.safeParse(input.password);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'パスワードを確認してください',
      field: 'password',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', field: 'general' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    return {
      ok: false,
      error: 'パスワードの設定に失敗しました。時間をおいて再度お試しください。',
      field: 'password',
    };
  }

  return { ok: true, message: 'パスワードを設定しました' };
}
