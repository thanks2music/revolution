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

import { createAdminClient } from '@/lib/supabase/admin';
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
 * username 可用性の結果型 (onboarding の debounce 補助表示用)。
 *
 * - 'available'   : 形式 OK かつ未使用 (✓ 使えます)
 * - 'taken'       : 形式 OK だが既に使用中 (✗ 既に使われています)
 * - 'invalid'     : 形式エラー (3-24・英数字 _) — error にメッセージ
 * - 'unknown'     : 重複チェック不能 (secret key 未設定 / 一時的なエラー)。
 *                   形式は OK。最終判定は submit 時の 23505 に委ねる。
 */
export type UsernameAvailability =
  | { status: 'available' }
  | { status: 'taken' }
  | { status: 'invalid'; error: string }
  | { status: 'unknown' };

/**
 * username のリアルタイム可用性チェック (M4。補助表示用、最終判定は submit 時の 23505)。
 *
 * Client から debounce (~400ms) で呼ぶ想定。
 *  1. Layer1 zod 形式チェック (真実源 `@revolution/schemas/profile` の UsernameSchema)。
 *     不正なら即 'invalid' を返し DB を叩かない。
 *  2. 形式 OK なら、RLS バイパスの admin クライアントで lower(username) の存在を確認。
 *     本人セッションでは RLS により他人行が見えず重複判定できないため secret key が必要。
 *     DB の lower(username) unique index と整合させるため case-insensitive (.ilike) で照合。
 *
 * 競合 (チェック後・submit 前に別ユーザーが同名確定) は本 Action では防げないため、
 * 最終判定は completeOnboarding の 23505 ハンドルで担保する (本 Action は摩擦低減の補助)。
 * secret key 未設定や DB エラー時は 'unknown' を返し、UI は形式 OK 表示に留める。
 */
export async function checkUsernameAvailability(
  username: string,
): Promise<UsernameAvailability> {
  // Layer1: zod 形式チェック (真実源)。不正なら DB を叩かない。
  const parsed = UsernameSchema.safeParse(username);
  if (!parsed.success) {
    return {
      status: 'invalid',
      error: parsed.error.issues[0]?.message ?? 'ユーザー名の形式が正しくありません',
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    // secret key 未設定 (CI 等)。重複チェック不能 → submit 時の 23505 に委ねる。
    return { status: 'unknown' };
  }

  // DB の `lower(username)` unique index と整合する case-insensitive 一致を判定する。
  //
  // 注: PostgREST の .ilike は LIKE パターンとして評価するため、username に許される
  // `_` (UsernameSchema: ^[a-zA-Z0-9_]+$) がワイルドカード「任意 1 文字」と誤解釈され、
  // 過剰マッチ (false positive) する。LIKE エスケープも PostgREST では不可。
  // そこで .ilike で候補を粗く取得し、JS 側で toLowerCase() の厳密一致に絞り直す。
  // 過剰マッチは候補集合を増やすだけで、最終判定は厳密一致なので正確 (件数も小規模)。
  const target = parsed.data.toLowerCase();
  const { data, error } = await admin
    .from('profiles')
    .select('username')
    .ilike('username', parsed.data)
    .limit(50);

  if (error) {
    // 一時的な DB エラー。チェック不能扱いにし submit の 23505 に委ねる。
    return { status: 'unknown' };
  }

  const taken = (data ?? []).some(
    (row) => typeof row.username === 'string' && row.username.toLowerCase() === target,
  );

  return taken ? { status: 'taken' } : { status: 'available' };
}
