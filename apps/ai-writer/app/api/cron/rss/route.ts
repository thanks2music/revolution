/**
 * Cloud Scheduler用RSSクローラーエンドポイント
 *
 * Pipeline Mode:
 * - MDX Pipeline: 本番運用モード (PIPELINE_TARGET=mdx)
 * - WordPress Pipeline: レガシーモード (PIPELINE_TARGET=wordpress)
 *
 * Codexレビュー指摘対応:
 * - crypto.timingSafeEqual() によるタイミング攻撃対策
 * - 同一401レスポンスでキー情報漏洩防止
 * - Firestore Idempotency対応 (Phase 1完了)
 * - エラーハンドリング (5xx/4xx判定)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { createHash, timingSafeEqual } from 'crypto';
import { isMdxMode, getPipelineModeDescription } from '../../../../lib/pipeline-mode';
import { createArticlePr } from '../../../../lib/github/createPr';
import {
  DuplicateSlugError,
  isRetryableGitHubError,
  getGitHubErrorStatus,
} from '../../../../lib/errors/github';
import {
  checkIfProcessed,
  markAsPending,
  markAsSuccess,
  markAsFailed,
} from '../../../../lib/firestore/processed-articles';
import { parseRssFeed } from '../../../../lib/rss/parser';
import { generateArticleWithClaude } from '../../../../lib/ai/article-generator';

/**
 * Cron認証キーをSecret Managerから取得 (キャッシュ)
 */
let cachedCronKey: string | null = null;

async function getCronKey(): Promise<string> {
  if (cachedCronKey) {
    return cachedCronKey;
  }

  const client = new SecretManagerServiceClient();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 't4v-revo-prd';
  const secretName = `projects/${projectId}/secrets/CRON_KEY/versions/latest`;

  const [version] = await client.accessSecretVersion({ name: secretName });
  const key = version.payload?.data?.toString();

  if (!key) {
    throw new Error('CRON_KEY is empty in Secret Manager');
  }

  cachedCronKey = key;
  return key;
}

/**
 * Timing-safe key comparison
 *
 * Codexレビュー指摘対応:
 * - crypto.timingSafeEqual() を使用
 * - 同じ401レスポンスでキー情報漏洩防止
 *
 * @param expected - 期待されるキー
 * @param provided - リクエストで提供されたキー
 * @returns 一致する場合 true
 */
function isValidCronKey(expected: string, provided: string | null): boolean {
  if (!provided) {
    return false;
  }

  try {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);

    // バッファサイズが異なる場合は false
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * Cloud Scheduler Cron エンドポイント (POST /api/cron/rss)
 *
 * Flow:
 * 1. X-CRON-KEY 認証
 * 2. Pipeline Mode 判定 (MDX or WordPress)
 * 3. 対応するパイプラインを実行
 *
 * @param request - Next.js Request
 * @returns Next.js Response
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Cron認証 (Timing-safe comparison)
    const providedKey = request.headers.get('x-cron-key');
    const expectedKey = await getCronKey();

    if (!isValidCronKey(expectedKey, providedKey)) {
      // 高レベルログのみ (キー漏洩防止)
      console.warn('Unauthorized cron request', {
        ip: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
      });

      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Request body 取得
    const body = await request.json();
    const { feedUrl } = body as { feedUrl?: string };

    if (!feedUrl) {
      return NextResponse.json(
        { error: 'feedUrl is required' },
        { status: 400 }
      );
    }

    // 3. Pipeline Mode 判定
    const pipelineMode = getPipelineModeDescription();
    console.log(`Running pipeline: ${pipelineMode}`, { feedUrl });

    if (isMdxMode()) {
      return await runMdxPipeline(feedUrl);
    } else {
      return await runWordpressPipeline(feedUrl);
    }
  } catch (error) {
    // エラーハンドリング (5xx/4xx判定)
    if (error instanceof DuplicateSlugError) {
      // 重複slug: 4xx (リトライ不要)
      console.info('Duplicate slug detected (skipping)', {
        slug: error.slug,
        existingPath: error.existingFilePath,
      });

      return NextResponse.json(
        {
          status: 'duplicate',
          slug: error.slug,
          existingPath: error.existingFilePath,
        },
        { status: 409 }
      );
    }

    if (isRetryableGitHubError(error)) {
      // リトライ可能エラー: 5xx (Cloud Scheduler が自動リトライ)
      console.error('Retryable GitHub error', { error });

      return NextResponse.json(
        { error: 'Temporary failure, will retry' },
        { status: getGitHubErrorStatus(error) }
      );
    }

    // その他のエラー: 500
    console.error('Unexpected error in cron/rss', { error });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * MDX Pipeline (本番運用モード)
 *
 * Flow:
 * 1. RSS取得
 * 2. Claude API (workTitle/storeName/eventType 抽出)
 * 3. Firestore (重複チェック + ULID生成)
 * 4. Claude API (categories/excerpt 生成)
 * 5. MDX Article 生成
 * 6. GitHub PR 作成
 * 7. Firestore (ステータス更新)
 *
 * @param feedUrl - RSS feed URL
 * @returns Next.js Response
 */
async function runMdxPipeline(feedUrl: string): Promise<NextResponse> {
  // TODO: Step 5 で実装
  console.log('MDX Pipeline implementation coming in Step 5');

  return NextResponse.json(
    { error: 'MDX Pipeline not yet implemented' },
    { status: 501 }
  );
}

/**
 * WordPress Pipeline (レガシーモード)
 *
 * Flow:
 * 1. RSS取得
 * 2. Idempotency チェック (Firestore)
 * 3. 記事生成 (Claude API)
 * 4. PR作成 (GitHub API)
 * 5. ステータス更新 (Firestore)
 *
 * @param feedUrl - RSS feed URL
 * @returns Next.js Response
 */
async function runWordpressPipeline(feedUrl: string): Promise<NextResponse> {

  // 1. RSSフィード取得
  console.log('[WordPress Pipeline] Fetching RSS feed:', feedUrl);
  const feedResult = await parseRssFeed(feedUrl, 1); // 最新1件のみ取得

  if (feedResult.items.length === 0) {
    return NextResponse.json(
      { error: 'No items in RSS feed' },
      { status: 404 }
    );
  }

  const rssItem = feedResult.items[0];
  const guid = rssItem.guid;

  console.log('[WordPress Pipeline] RSS item fetched:', {
    guid,
    title: rssItem.title,
    link: rssItem.link,
  });

  // 2. Idempotency チェック (Firestore)
  const existingRecord = await checkIfProcessed(feedUrl, guid);
  if (existingRecord) {
    console.info('[WordPress Pipeline] Article already processed', {
      feedUrl,
      guid,
      status: existingRecord.status,
      prNumber: existingRecord.prNumber,
    });

    return NextResponse.json(
      {
        status: 'already_processed',
        existingStatus: existingRecord.status,
        prNumber: existingRecord.prNumber,
        prUrl: existingRecord.prUrl,
      },
      { status: 200 }
    );
  }

  // 3. Claude APIで記事生成
  console.log('[WordPress Pipeline] Generating article with Claude API...');
  const articleResult = await generateArticleWithClaude({
    rssItem,
    feedMeta: {
      title: feedResult.meta.title,
      link: feedResult.meta.link,
    },
  });

  console.log('[WordPress Pipeline] Article generated:', {
    model: articleResult.model,
    inputTokens: articleResult.usage.inputTokens,
    outputTokens: articleResult.usage.outputTokens,
  });

  // 4. Frontmatterからslugを抽出（エラーハンドリング）
  const slugMatch = articleResult.markdown.match(/^slug:\s*(.+)$/m);
  if (!slugMatch) {
    throw new Error('Generated article missing "slug" in frontmatter');
  }
  const slug = slugMatch[1].trim();

  // 5. Processing開始をマーク
  const pendingResult = await markAsPending({
    feedUrl,
    guid,
    slug,
  });

  if (!pendingResult.allowed) {
    console.warn('[WordPress Pipeline] Processing not allowed', {
      feedUrl,
      guid,
      reason: pendingResult.reason,
    });

    return NextResponse.json(
      {
        status: 'not_allowed',
        reason: pendingResult.reason,
      },
      { status: 409 }
    );
  }

  // 6. PR作成
  let result;
  try {
    result = await createArticlePr({
      markdown: articleResult.markdown,
      source: {
        feedUrl,
        originalUrl: rssItem.link,
      },
    });

    console.log('[WordPress Pipeline] PR created:', {
      prNumber: result.prNumber,
      prUrl: result.prUrl,
    });

    // 7. 成功をマーク
    await markAsSuccess(
      { feedUrl, guid, slug },
      { prNumber: result.prNumber, prUrl: result.prUrl }
    );
  } catch (prError) {
    // PR作成失敗をマーク
    const errorMessage =
      prError instanceof Error ? prError.message : String(prError);
    await markAsFailed({ feedUrl, guid, slug }, errorMessage);

    // エラーを再スロー（外側のcatchブロックで処理）
    throw prError;
  }

  return NextResponse.json(
    {
      status: 'success',
      pipeline: 'wordpress',
      pr: {
        number: result.prNumber,
        url: result.prUrl,
        branch: result.branchName,
        file: result.filePath,
      },
    },
    { status: 200 }
  );
}

