'use client';

import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { canUseWebChecker } from '@/lib/auth/claims';
import { mapAuthError, type AuthErrorView } from '@/lib/auth/auth-error';
import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * ログインの状態と、使ってよいか (カスタムクレーム) の判定。
 *
 * 静的に書き出した画面なので、middleware も API Route も無い。ここでの判定も画面の出し分けも
 * 使い勝手のためで、DevTools から外せる。データを守るのは Firestore の rules (同じクレームを見る)。
 * 「画面で守っている」と思って rules を緩めないこと。
 */

export type AuthStatus =
  /** ログインの状態か、クレームを確かめている */
  | 'loading'
  /** ログインしていない */
  | 'unauthenticated'
  /** ログインしているが、クレームが無い */
  | 'forbidden'
  /** 使ってよい */
  | 'authorized';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  uid: string | null;
  email: string | null;
  error: AuthErrorView | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<AuthErrorView | null>(null);

  /**
   * クレームを見て状態を決める。手元のトークンにクレームが無ければ、1 回だけ取り直す
   * (クレームを付けてもらった直後は、手元のトークンが古いことがあるため)。
   */
  const evaluate = useCallback(async (nextUser: User): Promise<void> => {
    try {
      const cached = await nextUser.getIdTokenResult();
      if (canUseWebChecker(cached.claims)) {
        setStatus('authorized');
        return;
      }

      const fresh = await nextUser.getIdTokenResult(true);
      setStatus(canUseWebChecker(fresh.claims) ? 'authorized' : 'forbidden');
    } catch (caught) {
      // トークンが切れた・アカウントが無効になったなど。ログアウトして、ログインの前に戻す
      setError(mapAuthError(caught));
      await firebaseSignOut(getFirebaseAuth()).catch(() => undefined);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    // onIdTokenChanged はログイン・ログアウトに加え、トークンの更新 (既定で 1 時間ごと) でも呼ばれるので、
    // クレームが外された時にも状態が変わる
    return onIdTokenChanged(getFirebaseAuth(), nextUser => {
      setUser(nextUser);

      if (!nextUser) {
        setStatus('unauthenticated');
        return;
      }

      void evaluate(nextUser);
    });
  }, [evaluate]);

  const signIn = useCallback(async () => {
    setError(null);
    const provider = new GoogleAuthProvider();
    // 毎回アカウントを選ばせる
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      // redirect ではなく popup (サードパーティの Cookie の制限で、redirect が働かないことがあるため)
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (caught) {
      setError(mapAuthError(caught));
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      error,
      signIn,
      signOut,
      clearError,
    }),
    [status, user, error, signIn, signOut, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth は AuthProvider の内側でだけ使えます');
  }
  return context;
}
