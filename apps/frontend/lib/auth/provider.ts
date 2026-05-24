/**
 * provider 判定 (Crescendolls 会員機能 / M3) — Layer1 純粋関数
 *
 * Supabase User の `identities` 配列を見て、どの認証プロバイダで紐付いているかを
 * 判定する。マイページのアカウント管理 UI で「メール変更はメール登録ユーザーのみ可、
 * Google ユーザーは不可」を制御するために使う (確定仕様)。
 *
 * 設計:
 * - I/O を持たない純粋関数 (identities 配列を受け取って boolean を返すだけ)。
 *   getUser() の呼び出しは Server Action / Server Component の責務に留める。
 * - `identities` は Supabase User の標準フィールド。1 ユーザーが複数 provider を
 *   紐付けられる (例: email + google) ため、配列で判定する。
 * - `email` provider = Email OTP / Magic Link 由来。`google` provider = Google OAuth。
 *
 * 参照: @supabase/supabase-js の User.identities (UserIdentity[])。
 */

/** identities 配列のうち、判定に必要な provider フィールドだけを取り出した最小型。 */
export interface IdentityLike {
  provider: string;
}

/**
 * 与えられた identities に email provider が含まれるか。
 * true = Email OTP で登録 (= メール変更が可能なユーザー)。
 */
export function hasEmail(identities: readonly IdentityLike[] | null | undefined): boolean {
  if (!identities) return false;
  return identities.some((i) => i.provider === 'email');
}

/**
 * 与えられた identities に google provider が含まれるか。
 * true = Google OAuth で登録 (= メールは Google 管理のため変更不可)。
 */
export function hasGoogle(identities: readonly IdentityLike[] | null | undefined): boolean {
  if (!identities) return false;
  return identities.some((i) => i.provider === 'google');
}

/**
 * メールアドレスの変更が許可されるか。
 *
 * 確定仕様: メール変更はメール登録ユーザーのみ可能。Google ユーザーは不可
 * (メールが Google 側で管理されるため、Supabase 側で email を書き換えると
 * Google identity と乖離する)。
 *
 * email identity を持つユーザーのみ true。google のみのユーザーは false。
 * email + google 併用ユーザーは email を持つため true (email identity の更新は可能)。
 */
export function canChangeEmail(identities: readonly IdentityLike[] | null | undefined): boolean {
  return hasEmail(identities);
}
