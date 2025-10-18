/**
 * Debug API: 特定のテンプレート詳細取得
 * GET /api/debug/templates/:id
 */

import { NextRequest, NextResponse } from 'next/server';
import { templateLoaderService } from '../../../../../lib/services/template-loader.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
