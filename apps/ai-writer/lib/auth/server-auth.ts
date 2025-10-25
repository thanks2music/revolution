import { cookies } from 'next/headers';
import { adminAuth } from '../firebase/admin';
import { isEmailAllowed } from './allowed-emails';

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export async function verifyAuth(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      console.error('[Auth] No auth token found in cookies');
      return null;
    }

    // Firebase Admin SDK で Token を検証
    // checkRevoked: true で取り消されたトークンを拒否
    const decodedToken = await adminAuth.verifyIdToken(token, true);

    // メールアドレスが許可リストに含まれているかチェック
    if (!isEmailAllowed(decodedToken.email)) {
      console.error(
        `[Auth] Unauthorized email: ${decodedToken.email}. ` +
        'This email is not in the allowed list.'
      );
      return null;
    }

    return {
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      emailVerified: decodedToken.email_verified || false,
    };
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    return null;
  }
}

export async function requireAuth(): Promise<AuthUser> {
  const auth = await verifyAuth();
  if (!auth) {
    throw new Error('Unauthorized: Authentication required');
  }
  return auth;
}