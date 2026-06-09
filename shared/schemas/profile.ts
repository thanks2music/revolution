import { z } from 'zod';
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod';

import { profiles } from './db/profiles';

/**
 * Schema-SDD 真実源: profiles の zod 契約 (Layer1)
 *
 * username の正規表現・長さは **本ファイルの zod が真実源**。DB CHECK
 * (`shared/schemas/db/profiles.ts`) と `lower(username)` unique index は二段/三段防御。
 *
 * - USERNAME_REGEX / 長さ制約はここで一元定義し、frontend のバリデーション・
 *   onboarding Server Action (M2) が import して使う。
 * - drizzle-zod の createSelectSchema/createUpdateSchema でテーブル定義から
 *   ベーススキーマを派生し、username に refine をかける。
 *
 * 注 (drizzle-zod 0.8.x + zod v4): refine 引数は「カラム名 → zod スキーマ」の
 * マップ。username は DB 上 nullable のため、select はそのまま nullable、
 * update は本人が変更する値として username バリデーションを適用する。
 */

/**
 * username の正規表現 (真実源)。英数字とアンダースコアのみ、3-24 文字。
 * DB CHECK (`username ~ '^[a-zA-Z0-9_]{3,24}$'`) と同一。
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,24}$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

/**
 * username 単体の zod スキーマ (真実源)。onboarding/マイページの入力検証で再利用する。
 * 長さ違反・文字種違反で個別メッセージを出すため min/max と regex を分離。
 */
export const UsernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH, {
    message: `ユーザー名は ${USERNAME_MIN_LENGTH} 文字以上で入力してください`,
  })
  .max(USERNAME_MAX_LENGTH, {
    message: `ユーザー名は ${USERNAME_MAX_LENGTH} 文字以下で入力してください`,
  })
  .regex(USERNAME_REGEX, {
    message: '半角英数字とアンダースコア (_) のみ使用できます',
  });

/**
 * profiles 行の select スキーマ。username は DB 上 nullable のため nullable のまま
 * (onboarding 未完了 = NULL を表現)。
 */
export const ProfileSchema = createSelectSchema(profiles, {
  username: UsernameSchema.nullable(),
  // select は DB が返しうる値を忠実にモデル化する。handle_new_user トリガが
  // onboarding 前に display_name を空文字 (coalesce(..., '')) で作成しうるため、
  // select では min を課さない。非空保証は入力側 (ProfileUpdateSchema) で担保する。
  displayName: z.string(),
});

/**
 * profiles の update スキーマ。onboarding/マイページでの編集に使う。
 * username は実際に書き込む値としてバリデーション (NULL を書き込むことはしない)。
 */
export const ProfileUpdateSchema = createUpdateSchema(profiles, {
  username: UsernameSchema,
  displayName: z.string().min(1),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
