'use server';

/**
 * プロフィール Server Actions (Crescendolls 会員機能 / M2) — onboarding 完了処理
 *
 * onboarding: 「表示名」+「username (unique・3-24・^[a-zA-Z0-9_]+$)」を入力させ、
 * profiles を update する。完了後は JWT claims (案B) に `onboarded: true` を書く。
 *
 * 設計判断:
 * - profiles の update は **Supabase server クライアント経由** (RLS 適用) で行う。
 *   M1 の Drizzle client は DATABASE_URL = postgres ユーザー (RLS bypass) で接続
 *   するため、ここで Drizzle を使うと本人限定の保証が失われる。RLS を効かせ本人
 *   id の行だけ更新できる Supabase クライアント経由が二重防御として正しい。
 * - username 重複は最終的に DB の `lower(username)` unique index 違反 (PostgREST
 *   error.code === '23505') をハンドルしユーザー向けメッセージに変換する
 *   (case-insensitive 一致を含む)。
 * - username の正規表現・長さは `@revolution/schemas/profile` の zod (真実源) で
 *   検証 (Layer1)。DB CHECK + unique index は二段/三段防御。
 * - 完了処理は profiles update → updateUser({data:{onboarded:true}}) を同一処理で
 *   行う (案B、middleware が DB を叩かず JWT claims で判定するため)。
 */

import { ProfileUpdateSchema, UsernameSchema } from '@revolution/schemas/profile';

import { createClient } from '@/lib/supabase/server';

export type OnboardingResult =
  | { ok: true }
  | { ok: false; error: string; field?: 'username' | 'displayName' | 'general' };

const PG_UNIQUE_VIOLATION = '23505';

/**
 * onboarding 完了 (表示名 + username 設定)。
 */
export async function completeOnboarding(
  input: { username: string; displayName: string },
): Promise<OnboardingResult> {
  // Layer1: zod で username / displayName を検証 (真実源)
  const parsed = ProfileUpdateSchema.safeParse({
    username: input.username,
    displayName: input.displayName,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0];
    return {
      ok: false,
      error: issue?.message ?? '入力内容を確認してください',
      field:
        field === 'username'
          ? 'username'
          : field === 'displayName'
            ? 'displayName'
            : 'general',
    };
  }

  const supabase = await createClient();

  // 認証ユーザーを取得 (user_id はクライアント入力にしない = RLS と二重防御)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', field: 'general' };
  }

  // profiles を update (RLS により本人 id の行のみ更新可能)
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      username: parsed.data.username,
      display_name: parsed.data.displayName,
    })
    .eq('id', user.id);

  if (updateError) {
    if (updateError.code === PG_UNIQUE_VIOLATION) {
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

  // 案B: JWT claims に onboarding 完了フラグを書く (middleware は DB を叩かない)。
  // 注: updateUser は user レコードを更新するが、現行 access token (JWT) は不変で
  // user_metadata.onboarded は反映されない (新 token を返さない)。そのため直後に
  // refreshSession() を呼んで新 JWT を発行させ、cookie に書き込む。これで次の
  // ナビゲーションで middleware の getClaims() が onboarded:true を読める。
  const { error: metaError } = await supabase.auth.updateUser({
    data: { onboarded: true },
  });

  if (metaError) {
    // profiles は更新済みだが metadata 反映に失敗。次回ログインで JWT が更新される
    // ため致命的ではないが、UX のため再試行を促す。
    return {
      ok: false,
      error:
        'プロフィールは保存されましたが、設定の反映に失敗しました。再度お試しください。',
      field: 'general',
    };
  }

  // updateUser 後のセッション refresh で新 JWT (onboarded:true) を cookie へ反映。
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    // refresh 失敗時も profiles + metadata は更新済み。次回 cookie refresh で反映
    // されるため致命的ではないが、即時の middleware 判定が古い JWT になりうる。
    return {
      ok: false,
      error: '設定の反映に失敗しました。お手数ですが再度お試しください。',
      field: 'general',
    };
  }

  return { ok: true };
}

/**
 * username 単体のリアルタイム軽量チェック (補助。最終判定は 23505)。
 * Client から debounce して呼ぶ想定。形式チェック + 重複の事前確認。
 *
 * 重複確認は RLS で他人行が見えないため、SUPABASE_SECRET_KEY を使う必要がある。
 * M2 では形式チェックのみ提供し、重複の最終判定は completeOnboarding の 23505 に
 * 委ねる (secret-key count は過剰なため YAGNI、必要なら別タスク)。
 */
export async function checkUsernameFormat(
  username: string,
): Promise<{ valid: boolean; error?: string }> {
  const parsed = UsernameSchema.safeParse(username);
  if (!parsed.success) {
    return { valid: false, error: parsed.error.issues[0]?.message };
  }
  return { valid: true };
}
