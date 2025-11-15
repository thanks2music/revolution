/**
 * Cloud Scheduler用RSSクローラーエンドポイント
 *
 * Codexレビュー指摘対応:
 * - crypto.timingSafeEqual() によるタイミング攻撃対策
 * - 同一401レスポンスでキー情報漏洩防止
 * - Idempotency対応 (Phase 2でFirestore導入予定)
 * - エラーハンドリング (5xx/4xx判定)
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { timingSafeEqual } from 'crypto';
import { createArticlePr } from '../../../../lib/github/createPr';
import {
  DuplicateSlugError,
  isRetryableGitHubError,
  getGitHubErrorStatus,
} from '../../../../lib/errors/github';

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
 * 2. Idempotency チェック (Phase 2で実装予定)
 * 3. RSS取得
 * 4. 記事生成 (Claude API)
 * 5. PR作成 (GitHub API)
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

    // 3. Idempotency チェック (Phase 2: Firestore導入後に実装)
    // TODO: Feed item GUID をFirestoreでチェック
    // const isDuplicate = await checkDuplicateByGuid(feedItemGuid);
    // if (isDuplicate) {
    //   return NextResponse.json({ status: 'already_processed' }, { status: 200 });
    // }

    // 4. RSS取得 (簡易実装: Phase 1では省略、Phase 2で実装)
    // TODO: rss-parser を使用してRSS取得
    // const feedItems = await fetchRssFeed(feedUrl);

    // 5. 記事生成 (モックデータで動作確認)
    const mockMarkdown = generateMockArticle();

    // 6. PR作成
    const result = await createArticlePr({
      markdown: mockMarkdown,
      source: {
        feedUrl,
        originalUrl: 'https://example.com/original-article',
      },
    });

    return NextResponse.json(
      {
        status: 'success',
        pr: {
          number: result.prNumber,
          url: result.prUrl,
          branch: result.branchName,
          file: result.filePath,
        },
      },
      { status: 200 }
    );
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
 * モック記事生成 (Phase 1動作確認用)
 *
 * Phase 2で Claude API 統合時に置き換え
 */
function generateMockArticle(): string {
  const now = new Date().toISOString();
  const timestamp = Date.now();

  return `---
id: test-article-${timestamp}
title: Test Article Generated by Cron
slug: test-article-${timestamp}
date: ${now}
categories: ['tech', 'test']
tags: ['cron', 'automation', 'test']
excerpt: This is a test article generated by the Cloud Scheduler cron job to verify the RSS endpoint implementation.
author: AI Writer Bot
ogImage: https://example.com/og-image.png
---

# Test Article Generated by Cron

This article was automatically generated by the **Revolution AI Writer** cron job.

## Purpose

This test verifies:

1. Cloud Scheduler authentication
2. GitHub API integration
3. PR creation workflow
4. Markdown frontmatter parsing

## Next Steps

- [ ] Integrate Claude API for real article generation
- [ ] Implement RSS feed parsing
- [ ] Add Firestore idempotency checking

---

**Generated at**: ${now}
`;
}
