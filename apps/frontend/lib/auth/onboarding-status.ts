/**
 * onboarding 完了判定 (Layer1 純粋関数) — Crescendolls 会員機能 (M2)
 *
 * 案B: middleware は DB を叩かず JWT claims (`user_metadata.onboarded`) で判定する。
 * onboarding 完了 Server Action が `updateUser({ data: { onboarded: true } })` を書くと
 * user_metadata に `onboarded: true` が乗り、以降の JWT claims に反映される。
 *
 * 本関数は claims/metadata という「素の値」を受け取り boolean を返す純粋関数。
 * middleware (getClaims 由来の claims) / Server Component (getClaims) / テストの
 * いずれからも同一ロジックで判定できるよう、副作用も Supabase 依存も持たない。
 *
 * - claims が null/undefined (未ログイン) → false (= 未完了扱い、保護判定は別途認証で弾く)
 * - user_metadata.onboarded === true → 完了
 * - それ以外 (false / undefined / 型不一致) → 未完了
 */

/**
 * JWT claims (getClaims().data.claims) の最小形。
 * @supabase/auth-js の JwtPayload (user_metadata?: object, index signature あり) を
 * そのまま渡せるよう、user_metadata は unknown で受ける。
 */
export type OnboardingClaims =
  | {
      user_metadata?: unknown;
    }
  | null
  | undefined;

/**
 * user_metadata から onboarding 完了フラグを判定する純粋関数。
 * 厳密に boolean true のみを完了とみなす (truthy 文字列等で誤判定しない)。
 */
export function isOnboardedFromMetadata(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null) return false;
  return (metadata as Record<string, unknown>).onboarded === true;
}

/**
 * JWT claims 全体から onboarding 完了を判定する。
 * middleware は getClaims() の戻り値 claims をそのまま渡す。
 */
export function isOnboardedFromClaims(claims: OnboardingClaims): boolean {
  if (!claims) return false;
  return isOnboardedFromMetadata(claims.user_metadata);
}
