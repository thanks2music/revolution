/**
 * Debug API: テンプレート一覧取得
 * GET /api/debug/templates
 */

import { NextResponse } from 'next/server';
import { templateLoaderService } from '../../../../lib/services/template-loader.service';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/debug/templates] Authenticated user: ${authUser.email}`);

    console.log('[Debug API] テンプレート一覧取得開始');

    // テンプレート一覧を取得
    const templates = await templateLoaderService.getTemplateList();

    console.log('[Debug API] テンプレート一覧取得成功:', templates.length);

    return NextResponse.json({
      success: true,
      templates,
      count: templates.length,
    });
  } catch (error) {
    console.error('[Debug API] テンプレート一覧取得エラー:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
