import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const response = NextResponse.json({ success: true });

    response.cookies.delete('auth-token');

    return response;
  } catch (error) {
    console.error('Clear token error:', error);
    return NextResponse.json(
      { error: 'Failed to clear token' },
      { status: 500 }
    );
  }
}