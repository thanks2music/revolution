'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../firebase/client';

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
    // 開発環境では認証をバイパスしてダミーユーザーを設定
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      console.log('[AuthContext] Development mode - using mock user');

      // ダミーユーザーを作成（部分的なUser型）
      const mockUser = {
        uid: 'dev-user-local',
        email: 'dev@local.test',
        displayName: 'Development User',
        photoURL: null,
        emailVerified: true,
        // 最小限のUser型プロパティを追加
        getIdToken: async () => 'dev-token-local',
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

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[AuthContext] Auth state changed:', user ? user.email : 'null');

      if (user) {
        // メールアドレスのチェック（許可されたユーザーのみ）
        const allowedEmails = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS || '').split(',');
        console.log('[AuthContext] Checking email:', user.email, 'against allowed:', allowedEmails);

        if (!allowedEmails.includes(user.email || '')) {
          console.error('[AuthContext] Unauthorized email:', user.email);
          // 許可されていないユーザーは即座にサインアウト
          await signOut(auth);
          setUser(null);
          setLoading(false);
          return;
        }

        try {
          const token = await user.getIdToken();
          console.log('[AuthContext] Got ID token, length:', token.length);

          const response = await fetch('/api/auth/set-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });

          if (!response.ok) {
            console.error('[AuthContext] Failed to set token:', response.status);
          } else {
            console.log('[AuthContext] Token set successfully');
          }
        } catch (error) {
          console.error('[AuthContext] Error setting token:', error);
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
      const result = await signInWithPopup(auth, provider);
      const allowedEmails = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS || '').split(',');

      if (!allowedEmails.includes(result.user.email || '')) {
        await signOut(auth);
        throw new Error('このメールアドレスはアクセス権限がありません');
      }
    } catch (error) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/clear-token', { method: 'POST' });
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