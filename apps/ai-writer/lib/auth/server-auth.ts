import { cookies } from 'next/headers';
import { adminAuth } from '../firebase/admin';

export async function verifyAuth(): Promise<{ email: string; uid: string } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return null;
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',');

    if (!allowedEmails.includes(decodedToken.email || '')) {
      return null;
    }

    return {
      email: decodedToken.email || '',
      uid: decodedToken.uid,
    };
  } catch (error) {
    console.error('Auth verification error:', error);
    return null;
  }
}

export async function requireAuth() {
  const auth = await verifyAuth();
  if (!auth) {
    throw new Error('Unauthorized');
  }
  return auth;
}