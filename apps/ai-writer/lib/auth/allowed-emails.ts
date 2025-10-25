/**
 * 許可されたメールアドレスのリストを取得・正規化する共通ヘルパー
 */

/**
 * 環境変数から許可されたメールアドレスのリストを取得
 * - トリム、小文字化、フィルタリングを実行
 * - フェイルセーフ: 環境変数が空の場合はエラー
 */
export function getAllowedEmails(): string[] {
  const envValue = process.env.ALLOWED_EMAILS || '';

  if (!envValue.trim()) {
    throw new Error(
      '[Auth] CRITICAL: ALLOWED_EMAILS environment variable is not set. ' +
      'No users will be able to authenticate.'
    );
  }

  const emails = envValue
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0 && email.includes('@'));

  if (emails.length === 0) {
    throw new Error(
      '[Auth] CRITICAL: ALLOWED_EMAILS is set but contains no valid email addresses. ' +
      'No users will be able to authenticate.'
    );
  }

  return emails;
}

/**
 * 指定されたメールアドレスが許可リストに含まれているかチェック
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = getAllowedEmails();

  return allowedEmails.includes(normalizedEmail);
}
