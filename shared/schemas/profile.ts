import { z } from 'zod';
import { createSelectSchema, createUpdateSchema } from 'drizzle-zod';

import { profiles } from './db/profiles';

/**
 * Schema-SDD 真実源: profiles の zod 契約 (Layer1)
 *
 * username の正規表現・長さは **本ファイルの zod が真実源**。DB CHECK
 * (`shared/schemas/db/profiles.ts`) と `lower(username)` unique index は二段/三段防御。
 *
 * - USERNAME_REGEX / 長さ制約は username.ts で一元定義し (ここから export し直す)、frontend のバリデーション・
 *   onboarding Server Action (M2) が import して使う。
 * - drizzle-zod の createSelectSchema/createUpdateSchema でテーブル定義から
 *   ベーススキーマを派生し、username に refine をかける。
 *
 * 注 (drizzle-zod 0.8.x + zod v4): refine 引数は「カラム名 → zod スキーマ」の
 * マップ。username は DB 上 nullable のため、select はそのまま nullable、
 * update は本人が変更する値として username バリデーションを適用する。
 */

// ユーザー名の決まりは username.ts に置く (ブラウザで動く部品が、表の定義を読まずに使えるように)
export * from './username';
import { UsernameSchema } from './username';

/**
 * profiles 行の select スキーマ。username は DB 上 nullable のため nullable のまま
 * (onboarding 未完了 = NULL / 退会 = NULL を表現)。
 */
export const ProfileSchema = createSelectSchema(profiles, {
  username: UsernameSchema.nullable(),
  // select は DB が返しうる値を忠実にモデル化する。
  // - handle_new_user トリガが onboarding 前に display_name を空文字
  //   (coalesce(..., '')) で作成しうるため、select では min を課さない。
  // - ★ migration 0011 (M1) 以降、**退会時に null 化**される (PII 匿名化)。
  //   表示層は null を「退会済みユーザー」に読み替える必要がある。
  // 非空保証は入力側 (ProfileUpdateSchema) で担保する。
  displayName: z.string().nullable(),
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
