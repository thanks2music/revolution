/**
 * MDX記事用 GitHub PR作成モジュール (Phase 0.1専用)
 *
 * Purpose:
 *   - AI Writer生成のMDX記事をGitHub PRとして自動投稿
 *   - Firestore重複チェック + GitHub Open PR重複チェック
 *   - Service Account Committer設定
 *   - Slack通知統合
 *
 * @module lib/github/create-mdx-pr
 * @see {@link /notes/02-backlog/super-mvp-scope.md} Task 6
 */

import { createGitHubClient, REPO_CONFIG, wrapNetworkError } from './client';
import { checkEventDuplication, updateEventStatus } from '../firestore';
import { sendSlackNotification } from '../slack';
import {
  GitHubAuthError,
  GitHubNetworkError,
  DuplicateSlugError,
  BranchConflictError,
} from '../errors/github';
import { getAdminDb } from '../firebase/admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { EventCanonicalKey, ResolvedSlugs } from '../firestore/types';
import { FIRESTORE_COLLECTIONS } from '../firestore/types';

/**
 * MDX PR作成パラメータ
 */
export interface CreateMdxPrParams {
  /**
   * MDXファイルの内容
   */
  mdxContent: string;

  /**
   * ファイルパス (例: content/collabo-cafe/jujutsu-kaisen/01kaek3mh9-2025.mdx)
   */
  filePath: string;

  /**
   * PR タイトル
   */
  title: string;

  /**
   * PR 本文
   */
  body: string;

  /**
   * ブランチ名 (例: content/mdx-jujutsu-kaisen-01kaek3mh9)
   */
  branchName: string;

  /**
   * Firestore用のコンテキスト情報
   */
  context: {
    workTitle: string;
    storeName: string;
    eventTypeName: string;
    year: number;
    postId: string;
    workSlug: string;
    canonicalKey: string;
    /**
     * Optional: Pre-resolved slugs to avoid redundant Claude API calls
     */
    resolvedSlugs?: ResolvedSlugs;
  };
}

/**
 * PR作成結果
 */
export interface CreateMdxPrResult {
  /**
   * 作成されたPR番号
   */
  prNumber: number;

  /**
   * PR URL
   */
  prUrl: string;

  /**
   * 作成されたブランチ名
   */
  branchName: string;

  /**
   * コミットSHA
   */
  commitSha: string;
}

/**
 * Service Account Committer情報
 */
const SERVICE_ACCOUNT_COMMITTER = {
  name: 'Revolution AI Writer',
  email: 'ai-writer@revolution.example.com',
};

/**
 * GitHub Open PRの重複チェック
 *
 * @description
 * 同じブランチ名のOpen PRが存在するかチェックします。
 * Firestoreの重複チェックとは別に、GitHub側でもチェックを行います。
 *
 * @param {string} branchName - チェックするブランチ名
 * @returns {Promise<boolean>} - Open PRが存在する場合true
 */
async function checkDuplicateOpenPr(branchName: string): Promise<boolean> {
  try {
    const octokit = await createGitHubClient();

    const { data: pulls } = await octokit.pulls.list({
      owner: REPO_CONFIG.owner,
      repo: REPO_CONFIG.repo,
      state: 'open',
      head: `${REPO_CONFIG.owner}:${branchName}`,
    });

    return pulls.length > 0;
  } catch (error) {
    console.warn('[Create MDX PR] Failed to check duplicate PR:', error);
    // GitHub API エラーは警告のみ（Firestoreの重複チェックが主）
    return false;
  }
}

/**
 * MDX記事のGitHub PR作成
 *
 * @description
 * Phase 0.1のMDX記事生成フローのTask 6を実装します。
 *
 * 処理フロー:
 * 1. Firestore重複チェック
 * 2. GitHub Open PR重複チェック
 * 3. ベースブランチの最新コミット取得
 * 4. 新規ブランチ作成
 * 5. MDXファイルをコミット
 * 6. PR作成
 * 7. Firestore status更新
 *
 * エラーハンドリング:
 * - PR作成失敗 → Firestore status='failed' + Slack通知
 * - 重複PR → Error + Slack通知
 *
 * @param {CreateMdxPrParams} params - PR作成パラメータ
 * @returns {Promise<CreateMdxPrResult>} PR作成結果
 * @throws {DuplicateSlugError} - 重複PR検出時
 * @throws {GitHubAuthError} - 認証エラー
 * @throws {GitHubNetworkError} - ネットワークエラー
 * @throws {BranchConflictError} - ブランチ競合エラー
 *
 * @example
 * ```typescript
 * const result = await createMdxPr({
 *   mdxContent: '---\nslug: jujutsu-kaisen-cafe-2025\n...',
 *   filePath: 'content/collabo-cafe/jujutsu-kaisen/01kaek3mh9-2025.mdx',
 *   title: '✨ Generate MDX (AI Writer): ${extraction.eventTypeName}/${eventRecord.postId}`',
 *   body: '## 概要\nAI Writerが自動生成した記事です...',
 *   branchName: 'content/mdx-jujutsu-kaisen-01kaek3mh9',
 *   context: {
 *     workTitle: '呪術廻戦',
 *     storeName: 'アニメイトカフェ',
 *     eventTypeName: 'コラボカフェ',
 *     year: 2025,
 *     postId: '01kaek3mh9',
 *     workSlug: 'jujutsu-kaisen',
 *     canonicalKey: 'jujutsu-kaisen:animate-cafe:collabo-cafe:2025'
 *   }
 * });
 *
 * console.log(result.prUrl); // https://github.com/thanks2music/revolution/pull/123
 * ```
 */
export async function createMdxPr(params: CreateMdxPrParams): Promise<CreateMdxPrResult> {
  const { mdxContent, filePath, title, body, branchName, context } = params;

  console.log('[Create MDX PR] Starting PR creation process...');
  console.log(`  Branch: ${branchName}`);
  console.log(`  File: ${filePath}`);
  console.log(`  Canonical Key: ${context.canonicalKey}`);

  try {
    // ========================================
    // Step 1: Firestore重複チェック
    // ========================================
    console.log('[Create MDX PR] Step 1: Checking Firestore duplication...');

    const duplicationResult = await checkEventDuplication({
      workTitle: context.workTitle,
      storeName: context.storeName,
      eventTypeName: context.eventTypeName,
      year: context.year,
      resolvedSlugs: context.resolvedSlugs,
    });

    if (duplicationResult.isDuplicate) {
      const error = new DuplicateSlugError(
        `Event already exists: ${duplicationResult.canonicalKey}. ` +
          `Status: ${duplicationResult.existingDoc?.status}`,
        duplicationResult.canonicalKey,
        `Firestore event_canonical_keys/${duplicationResult.canonicalKey}`
      );

      // Slack通知
      await sendSlackNotification({
        type: 'duplicate_pr',
        error,
        context: {
          postId: context.postId,
          workSlug: context.workSlug,
          title,
          canonicalKey: context.canonicalKey,
          branchName,
        },
      });

      throw error;
    }

    console.log('  ✅ No duplicate in Firestore');

    // ========================================
    // Step 2.5: Firestore event document作成
    // ========================================
    console.log('[Create MDX PR] Step 2.5: Creating Firestore event document...');

    // Parse canonical key: {workSlug}:{storeSlug}:{eventType}:{year}
    const canonicalComponents = context.canonicalKey.split(':');
    if (canonicalComponents.length !== 4) {
      throw new Error(`Invalid canonical key format: ${context.canonicalKey}`);
    }
    const [workSlug, storeSlug, eventType, yearStr] = canonicalComponents;

    // Create Firestore document
    getAdminDb(); // Firebase Admin SDK初期化
    const db = getFirestore();
    const now = Timestamp.now();
    const eventDoc: EventCanonicalKey = {
      canonicalKey: context.canonicalKey,
      workSlug,
      storeSlug,
      eventType,
      year: context.year,
      postId: context.postId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
    };

    const docRef = db
      .collection(FIRESTORE_COLLECTIONS.EVENT_CANONICAL_KEYS)
      .doc(context.canonicalKey);

    try {
      await docRef.set(eventDoc);
      console.log(`  ✅ Firestore document created: ${context.canonicalKey}`);
    } catch (error: any) {
      // ALREADY_EXISTS の場合は警告のみ（重複チェック済みのはずだが念のため）
      if (error.code === 6 || error.message?.includes('already exists')) {
        console.warn(
          `  ⚠️  Firestore document already exists (duplicate check may have race condition): ${context.canonicalKey}`
        );
      } else {
        throw error;
      }
    }

    // ========================================
    // Step 3: GitHub Open PR重複チェック
    // ========================================
    console.log('[Create MDX PR] Step 3: Checking GitHub Open PR...');

    const hasDuplicatePr = await checkDuplicateOpenPr(branchName);

    if (hasDuplicatePr) {
      const error = new DuplicateSlugError(
        `Open PR already exists for branch: ${branchName}`,
        context.canonicalKey,
        `GitHub branch: ${branchName}`
      );

      // Slack通知
      await sendSlackNotification({
        type: 'duplicate_pr',
        error,
        context: {
          postId: context.postId,
          workSlug: context.workSlug,
          title,
          canonicalKey: context.canonicalKey,
          branchName,
        },
      });

      throw error;
    }

    console.log('  ✅ No duplicate Open PR in GitHub');

    // ========================================
    // Step 4: GitHub Client初期化
    // ========================================
    console.log('[Create MDX PR] Step 4: Initializing GitHub client...');

    const octokit = await createGitHubClient();

    // ========================================
    // Step 5: ベースブランチの最新コミット取得
    // ========================================
    console.log('[Create MDX PR] Step 5: Fetching base branch commit...');

    const { data: baseRef } = await octokit.git.getRef({
      owner: REPO_CONFIG.owner,
      repo: REPO_CONFIG.repo,
      ref: `heads/${REPO_CONFIG.baseBranch}`,
    });

    const baseSha = baseRef.object.sha;
    console.log(`  Base SHA: ${baseSha}`);

    // ========================================
    // Step 6: 新規ブランチ作成
    // ========================================
    console.log('[Create MDX PR] Step 6: Creating new branch...');

    try {
      await octokit.git.createRef({
        owner: REPO_CONFIG.owner,
        repo: REPO_CONFIG.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });

      console.log(`  ✅ Branch created: ${branchName}`);
    } catch (error: any) {
      if (error.status === 422 && error.message.includes('Reference already exists')) {
        throw new BranchConflictError(`Branch already exists: ${branchName}`, branchName);
      }
      throw error;
    }

    // ========================================
    // Step 7: MDXファイルをコミット
    // ========================================
    console.log('[Create MDX PR] Step 7: Committing MDX file...');

    // Base64エンコード
    const contentBase64 = Buffer.from(mdxContent, 'utf-8').toString('base64');

    const { data: commitData } = await octokit.repos.createOrUpdateFileContents({
      owner: REPO_CONFIG.owner,
      repo: REPO_CONFIG.repo,
      path: filePath,
      message: `✨ Add new article: ${title}

Generated by Revolution AI Writer
Post ID: ${context.postId}
Canonical Key: ${context.canonicalKey}`,
      content: contentBase64,
      branch: branchName,
      committer: SERVICE_ACCOUNT_COMMITTER,
      author: SERVICE_ACCOUNT_COMMITTER,
    });

    const commitSha = commitData.commit.sha!;
    console.log(`  ✅ File committed: ${commitSha}`);

    // ========================================
    // Step 8: PR作成
    // ========================================
    console.log('[Create MDX PR] Step 8: Creating Pull Request...');

    const { data: pr } = await octokit.pulls.create({
      owner: REPO_CONFIG.owner,
      repo: REPO_CONFIG.repo,
      title,
      body,
      head: branchName,
      base: REPO_CONFIG.baseBranch,
    });

    console.log(`  ✅ PR created: ${pr.html_url}`);

    // ========================================
    // Step 9: Firestore status更新
    // ========================================
    console.log('[Create MDX PR] Step 9: Updating Firestore status...');

    await updateEventStatus(context.canonicalKey, 'generated');

    console.log('  ✅ Firestore status updated to "generated"');

    // ========================================
    // 完了
    // ========================================
    console.log('[Create MDX PR] ✅ PR creation completed successfully!');

    return {
      prNumber: pr.number,
      prUrl: pr.html_url,
      branchName,
      commitSha,
    };
  } catch (error) {
    // エラーハンドリング
    console.error('[Create MDX PR] ❌ Error during PR creation:', error);

    // Firestore status更新
    try {
      await updateEventStatus(
        context.canonicalKey,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } catch (firestoreError) {
      console.error('[Create MDX PR] Failed to update Firestore status:', firestoreError);
    }

    // Slack通知 (重複エラー以外)
    if (!(error instanceof DuplicateSlugError)) {
      await sendSlackNotification({
        type: 'pr_failed',
        error: error instanceof Error ? error : new Error('Unknown error'),
        context: {
          postId: context.postId,
          workSlug: context.workSlug,
          title,
          canonicalKey: context.canonicalKey,
          branchName,
          filePath,
        },
      });
    }

    // エラーを再スロー
    if (error instanceof GitHubAuthError || error instanceof DuplicateSlugError) {
      throw error;
    }

    if (error instanceof Error && 'status' in error) {
      const statusError = error as { status: number };
      if (statusError.status === 401 || statusError.status === 403) {
        throw new GitHubAuthError('GitHub authentication failed', error);
      }
    }

    wrapNetworkError(error);
  }
}
