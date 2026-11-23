/**
 * エラーコード → 画面の振る舞い。自分でポップアップを閉じただけなら何も出さず、
 * 素のエラーコードを利用者向けの文言に混ぜない。
 */

import { mapAuthError } from '@/lib/auth/auth-error';

const firebaseError = (code: string) => ({ name: 'FirebaseError', code, message: `mock ${code}` });

describe('mapAuthError', () => {
  it.each([['auth/popup-closed-by-user'], ['auth/cancelled-popup-request']])(
    'shows nothing for %s (the user cancelled deliberately)',
    code => {
      expect(mapAuthError(firebaseError(code))).toBeNull();
    }
  );

  it.each([
    ['auth/popup-blocked'],
    ['auth/network-request-failed'],
    ['auth/too-many-requests'],
    ['unavailable'],
  ])('offers a retry for %s', code => {
    const view = mapAuthError(firebaseError(code));

    expect(view?.kind).toBe('retryable');
    expect(view?.retryable).toBe(true);
  });

  it.each([['permission-denied'], ['auth/user-disabled']])(
    'reports %s as missing permission',
    code => {
      const view = mapAuthError(firebaseError(code));

      expect(view?.kind).toBe('denied');
      expect(view?.retryable).toBe(false);
    }
  );

  it.each([['auth/unauthorized-domain'], ['auth/operation-not-allowed']])(
    'flags %s as a configuration problem',
    code => {
      expect(mapAuthError(firebaseError(code))?.kind).toBe('config');
    }
  );

  it('surfaces the code for unrecognised errors so support can act on it', () => {
    const view = mapAuthError(firebaseError('auth/internal-error'));

    expect(view?.kind).toBe('unknown');
    expect(view?.code).toBe('auth/internal-error');
  });

  it('handles values that are not Firebase errors at all', () => {
    expect(mapAuthError(new Error('boom'))?.kind).toBe('unknown');
    expect(mapAuthError(undefined)?.kind).toBe('unknown');
  });

  it('never leaks a raw code into the user-facing message', () => {
    for (const code of ['permission-denied', 'auth/user-disabled', 'auth/popup-blocked']) {
      expect(mapAuthError(firebaseError(code))?.message).not.toContain(code);
    }
  });
});
