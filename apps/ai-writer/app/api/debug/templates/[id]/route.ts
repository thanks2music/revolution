/**
 * Debug API: 特定のテンプレート詳細取得
 * GET /api/debug/templates/:id
 */

import { NextRequest, NextResponse } from 'next/server';
import { templateLoaderService } from '../../../../../lib/services/template-loader.service';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/debug/templates/:id] Authenticated user: ${authUser.email}`);

    const { id: templateId } = await params;

    console.log('[Debug API] テンプレート詳細取得開始:', templateId);

    // テンプレートを取得
    const template = await templateLoaderService.loadTemplateById(templateId);

    console.log('[Debug API] テンプレート詳細取得成功:', template.template.name);

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    console.error('[Debug API] テンプレート詳細取得エラー:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
