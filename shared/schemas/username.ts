import { z } from 'zod';

/**
 * ユーザー名の決まり (正規表現・長さ・zod のスキーマ)。DB の表の定義 (drizzle) を読まないファイルに分けてある。
 * ブラウザで動く部品 (onboarding・マイページ) はここから読む。`profile.ts` からも同じ物を export し直している
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
