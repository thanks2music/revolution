'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirebaseAuth } from '../firebase/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🚨 開発環境判定を厳格化
    // - NODE_ENV === 'development' であること
    // - かつ window.location.hostname が localhost または 127.0.0.1 であること
    // - かつ NEXT_PUBLIC_BYPASS_AUTH_FOR_DEV が明示的に 'true' に設定されていること
    const isDevelopment =
      process.env.NODE_ENV === 'development' &&
      (typeof window !== 'undefined' &&
       (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1')) &&
      process.env.NEXT_PUBLIC_BYPASS_AUTH_FOR_DEV === 'true';

    if (isDevelopment) {
      console.log('[AuthContext] Development mode with auth bypass enabled - using mock user');

      // ダミーユーザーを作成（部分的なUser型）
      // 注意: カスタムクレームはgetIdTokenResult()で取得されるが、
      // Firestore Security Rulesで認識させるにはFirebase Emulator Suiteが必要
      const mockUser = {
        uid: 'dev-user-local',
        email: 'dev@local.test',
        displayName: 'Development User (Admin)',
        photoURL: null,
        emailVerified: true,
        // 最小限のUser型プロパティを追加
        getIdToken: async () => 'dev-token-local',
        // カスタムクレームを含むトークン情報を返す（開発環境用モック）
        getIdTokenResult: async () => ({
          token: 'dev-token-local',
          expirationTime: new Date(Date.now() + 3600000).toISOString(),
          authTime: new Date().toISOString(),
          issuedAtTime: new Date().toISOString(),
          signInProvider: 'mock',
          signInSecondFactor: null,
          claims: {
            // 管理者権限を付与（開発環境用）
            admin: true,
            allowedEditor: true,
            email: 'dev@local.test',
            email_verified: true,
            user_id: 'dev-user-local',
          },
        }),
      } as User;

      setUser(mockUser);
      setLoading(false);

      // 開発環境では認証リスナーを設定しない
      return () => {
        console.log('[AuthContext] Development mode - no cleanup needed');
      };
    }

    // 本番環境では通常の認証フロー
    console.log('[AuthContext] Production mode - setting up auth listener');

    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[AuthContext] Auth state changed:', user ? user.email : 'null');

      if (user) {
        try {
          const token = await user.getIdToken();
          console.log('[AuthContext] Got ID token, length:', token.length);

          // /api/auth/set-token でサーバーサイド検証を実施
          // - Firebase Admin SDK による Token 検証
          // - メールアドレスの許可リストチェック
          const response = await fetch('/api/auth/set-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });

          if (!response.ok) {
            // 401 (Invalid token) または 403 (Unauthorized email) の場合
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('[AuthContext] Server rejected token:', response.status, errorData.error);

            // サインアウトしてユーザーをクリア
            await signOut(auth);
            setUser(null);
            setLoading(false);
            return;
          }

          console.log('[AuthContext] Token verified and set successfully');
        } catch (error) {
          console.error('[AuthContext] Error setting token:', error);
          // エラー時もサインアウト
          await signOut(auth);
          setUser(null);
          setLoading(false);
          return;
        }
      } else {
        console.log('[AuthContext] No user, clearing token');
        await fetch('/api/auth/clear-token', { method: 'POST' }).catch(console.error);
      }

      setUser(user);
      setLoading(false);
    });

    return () => {
      console.log('[AuthContext] Cleaning up auth listener');
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      // signInWithPopup を実行
      // メール検証は onAuthStateChanged と /api/auth/set-token で実施されるため、
      // ここでは重複チェックを行わない（Race Condition 回避）
      const auth = getFirebaseAuth();
      await signInWithPopup(auth, provider);

      // onAuthStateChanged が自動的に発火し、
      // /api/auth/set-token でサーバーサイド検証が行われる
    } catch (error) {
      console.error('[AuthContext] Google sign-in error:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/clear-token', { method: 'POST' });
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);