/**
 * Firebase のエラーを、画面がとる振る舞いに直す。素のエラーコードと英文は利用者に出さない。
 *
 * - `silent`: 何も出さない (自分でポップアップを閉じた時など)
 * - `retryable`: 文言と、やり直しの導線
 * - `denied`: 権限が無い。やり直しても変わらない
 * - `config`: 設定の不備。直すのは運用する側
 * - `unknown`: 想定外。問い合わせに要るのでコードも見せる
 */
export type AuthErrorKind = 'silent' | 'retryable' | 'denied' | 'config' | 'unknown';

export interface AuthErrorView {
  kind: Exclude<AuthErrorKind, 'silent'>;
  title: string;
  message: string;
  /** やり直しのボタンを出すか */
  retryable: boolean;
  /** 問い合わせ用に小さく添えるコード (unknown の時だけ) */
  code?: string;
}

/** 例外から `code` を取り出す。SDK の型に頼らず、形で見る */
function extractCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

/** エラーを画面に出す形に直す。出さなくてよい物は null */
export function mapAuthError(error: unknown): AuthErrorView | null {
  const code = extractCode(error);

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;

    case 'auth/popup-blocked':
      return {
        kind: 'retryable',
        title: 'ポップアップがブロックされました',
        message:
          'ブラウザの設定でこのサイトのポップアップを許可してから、もう一度ログインしてください。',
        retryable: true,
      };

    case 'auth/network-request-failed':
      return {
        kind: 'retryable',
        title: '通信エラー',
        message: 'ネットワークに接続できませんでした。もう一度お試しください。',
        retryable: true,
      };

    case 'auth/too-many-requests':
      return {
        kind: 'retryable',
        title: '試行回数が上限に達しました',
        message: 'しばらく時間をおいてから、もう一度お試しください。',
        retryable: true,
      };

    case 'unavailable':
      return {
        kind: 'retryable',
        title: 'データベースに接続できません',
        message: '一時的な問題の可能性があります。もう一度お試しください。',
        retryable: true,
      };

    // Firestore の rules に弾かれた。権限 (カスタムクレーム) が無いか、外された
    case 'permission-denied':
      return {
        kind: 'denied',
        title: '権限がありません',
        message: 'このアカウントには、この操作をする権限がありません。',
        retryable: false,
      };

    case 'auth/user-disabled':
      return {
        kind: 'denied',
        title: 'このアカウントは使えません',
        message: 'アカウントが無効になっています。',
        retryable: false,
      };

    case 'auth/unauthorized-domain':
      return {
        kind: 'config',
        title: 'このドメインは許可されていません',
        message: 'Firebase Authentication の承認済みドメインに、このドメインを足してください。',
        retryable: false,
      };

    case 'auth/operation-not-allowed':
      return {
        kind: 'config',
        title: 'Google のログインが有効になっていません',
        message: 'Firebase Authentication で Google のプロバイダを有効にしてください。',
        retryable: false,
      };

    default:
      return {
        kind: 'unknown',
        title: 'エラーが発生しました',
        message: '時間をおいてから、もう一度お試しください。',
        retryable: true,
        code: code ?? undefined,
      };
  }
}
