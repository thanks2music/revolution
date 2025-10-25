import { NextRequest, NextResponse } from 'next/server';
import { getClaudeService } from '../../../../lib/server/claude-api.service';
import { requireAuth } from '@/lib/auth/server-auth';

// Force dynamic rendering to prevent build-time execution
export const dynamic = 'force-dynamic';

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/extract-from-url] Authenticated user: ${authUser.email}`);

    const body = await request.json();

    // URLの検証
    if (!body.url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    const {
      url,
      extractOnly = false, // trueの場合は抽出のみ、falseの場合は記事生成まで行う
      title,
      keywords,
      targetLength = 600,
      tone = 'friendly',
      language = 'ja'
    } = body;

    console.log(`Processing URL: ${url}`);

    const claudeService = getClaudeService();

    if (extractOnly) {
      // コンテンツ抽出のみ
      console.log('Extracting content only...');
      const extractedContent = await claudeService.extractContentFromURL(url);

      return NextResponse.json({
        success: true,
        extracted: extractedContent,
        message: 'Content extracted successfully'
      });

    } else {
      // コンテンツ抽出 + 記事生成
      console.log('Extracting content and generating article...');
      const generatedArticle = await claudeService.generateArticleFromURL(url, {
        title,
        keywords: keywords || [],
        targetLength,
        tone,
        language
      });

      return NextResponse.json({
        success: true,
        article: generatedArticle,
        message: 'Article generated from URL successfully'
      });
    }

  } catch (error) {
    console.error('URL processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process URL',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * 🔒 Protected route - requires authentication
 */
export async function GET() {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/articles/extract-from-url] Authenticated user: ${authUser.email}`);

    return NextResponse.json({
    message: 'URL Content Extraction and Article Generation API',
    endpoint: 'POST /api/articles/extract-from-url',
    description: 'Extract content from URL and optionally generate article with Claude API',
    body: {
      url: 'string (required) - URL to extract content from',
      extractOnly: 'boolean (optional, default: false) - if true, only extract content',
      title: 'string (optional) - custom title for generated article',
      keywords: 'string[] (optional) - keywords for article generation',
      targetLength: 'number (optional, default: 600) - target article length',
      tone: 'professional|casual|technical|friendly (optional, default: friendly)',
      language: 'ja|en (optional, default: ja)'
    },
    modes: {
      extractOnly_true: 'Extract content only (title, content, description, etc.)',
      extractOnly_false: 'Extract content and generate full article using Claude API'
    }
    });
  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
}