/**
 * MDX Pipeline Debug API Route
 *
 * Purpose:
 *   - Generate MDX article from RSS feed (for debug/manual testing)
 *   - Create GitHub PR with generated MDX content
 *   - Stream progress updates via Server-Sent Events (SSE)
 *
 * This is the MDX version of `/api/debug/generate-from-feed/route.ts`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max execution

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import Parser from 'rss-parser';
import {
  ArticleGenerationMdxService,
  type MdxGenerationRequest,
} from '@/lib/services/article-generation-mdx.service';
import { DuplicateSlugError } from '@/lib/errors/github';

/**
 * POST /api/debug/generate-from-feed-mdx
 *
 * Generate MDX article from RSS feed and create GitHub PR
 *
 * Request Body:
 * {
 *   feedUrl: string;     // RSS feed URL to process
 *   itemIndex?: number;  // Item index to process (default: 0)
 * }
 *
 * Response: Server-Sent Events (SSE) stream
 *
 * SSE Progress Events:
 * 1. Fetching RSS feed
 * 2. Extracting information with Claude API
 * 3. Checking for duplicates in Firestore
 * 4. Generating MDX article
 * 5. Creating GitHub PR
 * 6. Complete (with PR URL)
 */
export async function POST(request: NextRequest) {
  // Setup SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendError = (error: string) => {
        const eventData = `data: ${JSON.stringify({ error })}\n\n`;
        controller.enqueue(encoder.encode(eventData));
        controller.close();
      };

      // Authentication check
      try {
        const authUser = await requireAuth();
        console.log(`[API /api/debug/generate-from-feed-mdx] Authenticated user: ${authUser.email}`);
      } catch (error) {
        console.error('[API /api/debug/generate-from-feed-mdx] Authentication failed:', error);
        sendError('Authentication required');
        return;
      }

      // Parse request body
      let feedUrl: string;
      let itemIndex: number = 0;

      try {
        const body = await request.json();
        feedUrl = body.feedUrl;
        itemIndex = body.itemIndex ?? 0;

        if (!feedUrl) {
          sendError('feedUrl is required');
          return;
        }
      } catch (error) {
        sendError('Invalid request body');
        return;
      }

      const sendEvent = (data: { step: number; totalSteps: number; message: string; detail?: string }) => {
        const eventData = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(eventData));
      };

      const sendComplete = (result: any) => {
        const eventData = `data: ${JSON.stringify({ complete: true, result })}\n\n`;
        controller.enqueue(encoder.encode(eventData));
        controller.close();
      };

      try {
        const TOTAL_STEPS = 6;

        // Step 1: Fetch RSS feed
        sendEvent({
          step: 1,
          totalSteps: TOTAL_STEPS,
          message: 'RSSフィードを取得中...',
          detail: feedUrl,
        });

        // Parse RSS feed directly
        const parser = new Parser({
          customFields: {
            item: ['content', 'content:encoded', 'description']
          }
        });

        const parsedFeed = await parser.parseURL(feedUrl);
        const items = parsedFeed.items || [];

        if (items.length === 0) {
          sendError('RSSフィードに記事が見つかりませんでした');
          return;
        }

        if (itemIndex >= items.length) {
          sendError(`指定されたインデックス ${itemIndex} は範囲外です（最大: ${items.length - 1}）`);
          return;
        }

        sendEvent({
          step: 1,
          totalSteps: TOTAL_STEPS,
          message: 'RSSフィード取得完了',
          detail: `${items.length}件の記事を取得`,
        });

        // Step 2-6: Try to find and generate a non-duplicate article
        const MAX_ATTEMPTS = 10; // Try up to 10 items
        const mdxService = new ArticleGenerationMdxService();
        let currentIndex = itemIndex;
        let lastError: Error | null = null;
        let generationSuccessful = false;
        let result: any = null;
        let rssItem: { title: string; link: string; content: string; contentSnippet: string; pubDate: string } = {
          title: 'No title',
          link: '',
          content: '',
          contentSnippet: '',
          pubDate: new Date().toISOString(),
        };

        console.log(`[API Route] Starting while loop: currentIndex=${currentIndex}, items.length=${items.length}, MAX_ATTEMPTS=${MAX_ATTEMPTS}`);

        while (currentIndex < Math.min(items.length, itemIndex + MAX_ATTEMPTS) && !generationSuccessful) {
          console.log(`[API Route] While loop iteration ${currentIndex - itemIndex + 1}: processing item ${currentIndex + 1}/${items.length}`);

          try {
            const item = items[currentIndex];
            rssItem = {
              title: item.title || 'No title',
              link: item.link || '',
              content: item['content:encoded'] || item.content || '',
              contentSnippet: item.contentSnippet || item.summary || item.description || '',
              pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            };

            console.log(`[API Route] Processing RSS item: "${rssItem.title}"`);

            sendEvent({
              step: 2,
              totalSteps: TOTAL_STEPS,
              message: `記事 ${currentIndex + 1}/${items.length} を処理中...`,
              detail: rssItem.title,
            });

            const generationRequest: MdxGenerationRequest = {
              rssItem: {
                title: rssItem.title,
                link: rssItem.link,
                content: rssItem.content,
                contentSnippet: rssItem.contentSnippet,
                pubDate: rssItem.pubDate,
              },
            };

            // Progress updates for each step
            const progressSteps = [
              { step: 2, message: '作品/店舗/イベント情報を抽出中...' },
              { step: 3, message: 'Firestoreで重複チェック中...' },
              { step: 4, message: 'カテゴリと抜粋を生成中...' },
              { step: 5, message: 'MDX記事を生成中...' },
              { step: 6, message: 'GitHub PRを作成中...' },
            ];

            // Send progress updates (simulation - actual progress is handled by service)
            for (const progress of progressSteps) {
              sendEvent({
                step: progress.step,
                totalSteps: TOTAL_STEPS,
                message: progress.message,
              });

              // Small delay for UI feedback
              if (progress.step < TOTAL_STEPS) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }

            // Execute MDX generation
            result = await mdxService.generateMdxFromRSS(generationRequest);
            generationSuccessful = true;

          } catch (error) {
            console.error(`[API Route] Caught error in while loop (attempt ${currentIndex - itemIndex + 1}/${MAX_ATTEMPTS})`);
            console.error('[API Route] Error type:', error?.constructor?.name);
            console.error('[API Route] instanceof DuplicateSlugError:', error instanceof DuplicateSlugError);

            if (error instanceof DuplicateSlugError) {
              console.log(`[API Route] ✅ Duplicate detected, skipping to next item (${currentIndex} → ${currentIndex + 1})`);

              // Duplicate found, try next item
              sendEvent({
                step: 2,
                totalSteps: TOTAL_STEPS,
                message: `記事 ${currentIndex + 1} はスキップ（重複）`,
                detail: error.message,
              });
              lastError = error;
              currentIndex++;
              continue;
            } else {
              console.error('[API Route] ❌ Not a DuplicateSlugError, rethrowing');
              // Other error, rethrow
              throw error;
            }
          }
        }

        if (!generationSuccessful) {
          sendError(
            `すべての記事が重複しています（${currentIndex - itemIndex}件確認）。` +
            (lastError ? `\n最後のエラー: ${lastError.message}` : '')
          );
          return;
        }

        if (!result.success) {
          sendError(result.error || 'MDX記事の生成に失敗しました');
          return;
        }

        // Send completion event
        sendComplete({
          success: true,
          mdxArticle: {
            title: rssItem.title,
            filePath: result.mdxArticle?.filePath,
            slug: result.details?.postId,
          },
          github: {
            prNumber: result.prResult?.prNumber,
            prUrl: result.prResult?.prUrl,
            branchName: result.prResult?.branchName,
          },
          event: {
            canonicalKey: result.details?.canonicalKey,
            postId: result.details?.postId,
            workSlug: result.details?.workSlug,
            year: result.details?.year,
          },
        });

      } catch (error) {
        console.error('[MDX Debug API] Generation error:', error);
        console.error('[MDX Debug API] Error type:', error?.constructor?.name);
        console.error('[MDX Debug API] instanceof check:', error instanceof DuplicateSlugError);

        // Handle duplicate slug error
        if (error instanceof DuplicateSlugError) {
          console.error('[MDX Debug API] Sending duplicate error with canonical key');

          // Extract canonical key from error message
          // Message format: "このイベントは既に生成済みです: {canonicalKey}"
          const canonicalKeyMatch = error.message.match(/: (.+)$/);
          const canonicalKey = canonicalKeyMatch ? canonicalKeyMatch[1] : error.slug;

          // Send error with canonical key for reset button
          const eventData = `data: ${JSON.stringify({
            error: error.message,
            event: {
              canonicalKey: canonicalKey,
            }
          })}\n\n`;
          controller.enqueue(encoder.encode(eventData));
          controller.close();
          return;
        }

        sendError(error instanceof Error ? error.message : 'Unknown error occurred');
      }
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
