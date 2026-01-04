import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/admin';
import { isEmailAllowed } from '@/lib/auth/allowed-emails';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Firebase Admin SDK で Token を検証
    // checkRevoked: true で取り消されたトークンを拒否
    let decodedToken;
    try {
      const adminAuth = getAdminAuth();
      decodedToken = await adminAuth.verifyIdToken(token, true);
    } catch (verifyError) {
      console.error('[API /api/auth/set-token] Token verification failed:', verifyError);
      const errorCode = (verifyError as any)?.code;
      const errorMessage = errorCode === 'auth/id-token-revoked'
        ? 'Token has been revoked'
        : 'Invalid token';
      return NextResponse.json(
        { error: errorMessage },
        { status: 401 }
      );
    }

    // メールアドレスが許可リストに含まれているかチェック
    if (!isEmailAllowed(decodedToken.email)) {
      console.error(
        `[API /api/auth/set-token] Unauthorized email: ${decodedToken.email}. ` +
        'This email is not in the allowed list.'
      );
      return NextResponse.json(
        { error: 'Unauthorized: Email not allowed' },
        { status: 403 }
      );
    }

    // 検証成功 → Cookie を設定
    console.log(`[API /api/auth/set-token] Token verified for ${decodedToken.email}`);

    const response = NextResponse.json({
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified || false,
      }
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[API /api/auth/set-token] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to set token' },
      { status: 500 }
    );
  }
}