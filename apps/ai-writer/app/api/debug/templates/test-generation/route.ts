/**
 * Debug API: テンプレートベース記事生成のテスト
 * POST /api/debug/templates/test-generation
 *
 * Request Body:
 * {
 *   "rssArticle": {
 *     "title": "記事タイトル",
 *     "link": "https://example.com/article",
 *     "contentSnippet": "記事の概要"
 *   },
 *   "forceTemplateId": "collabo-cafe" (optional),
 *   "validationKeywords": ["コラボカフェ", "カフェ"] (optional)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { ArticleGenerationService } from '../../../../../lib/services/article-generation.service';
import { RssArticleEntry } from '../../../../../lib/types/rss-article';
import { PostStatus } from '../../../../../lib/services/wordpress-graphql.service';
import { requireAuth } from '@/lib/auth/server-auth';

/**
 * 🔒 Protected route - requires authentication
 */
export async function POST(request: NextRequest) {
  try {
    // 🔒 認証チェック
    const authUser = await requireAuth();
    console.log(`[API /api/debug/templates/test-generation] Authenticated user: ${authUser.email}`);

    const body = await request.json();
    const { rssArticle, forceTemplateId, validationKeywords } = body;

    console.log('[Debug API] テンプレートベース記事生成テスト開始');
    console.log('RSS記事:', rssArticle);
    console.log('強制テンプレートID:', forceTemplateId);
    console.log('検証キーワード:', validationKeywords);

    // Validate request
    if (!rssArticle || !rssArticle.link) {
      return NextResponse.json(
        {
          success: false,
          error: 'rssArticle.link is required',
        },
        { status: 400 }
      );
    }

    // ArticleGenerationServiceのインスタンスを作成
    const articleService = new ArticleGenerationService({
      useClaudeAPI: true,
      wordPressEndpoint: process.env.NEXT_PUBLIC_WP_ENDPOINT || '',
      defaultStatus: PostStatus.DRAFT,
    });

    // RssArticleEntry形式に変換
    const rssEntry: RssArticleEntry = {
      title: rssArticle.title || 'Untitled',
      link: rssArticle.link,
      description: rssArticle.contentSnippet || rssArticle.title,
      pubDate: new Date().toISOString(),
      categories: rssArticle.categories || [],
    };

    // テンプレートベース記事生成を実行
    const result = await articleService.generateArticleFromRssUsingTemplate(
      rssEntry,
      {
        forceTemplateId,
        validationKeywords,
        publishStatus: PostStatus.DRAFT, // 下書きとして投稿（テスト用）
      }
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      );
    }

    console.log('[Debug API] テンプレートベース記事生成テスト成功');

    return NextResponse.json({
      success: true,
      result: {
        template: {
          id: result.template?.template.id,
          name: result.template?.template.name,
          eventTypes: result.template?.template.eventTypes,
        },
        renderedContent: result.renderedContent,
        extractedData: result.context?.extractedData,
        validationResult: result.context?.validationResult,
        publishResult: result.publishResult ? {
          postId: result.publishResult.postId,
          databaseId: result.publishResult.databaseId,
          postUrl: result.publishResult.postUrl,
          wordPressCategories: result.publishResult.wordPressCategories,
        } : null,
      },
    });
  } catch (error) {
    console.error('[Debug API] テンプレートベース記事生成テストエラー:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
