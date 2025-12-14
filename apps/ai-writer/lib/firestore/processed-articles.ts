import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../firebase/admin';

/**
 * 処理済みRSS記事のFirestoreドキュメントスキーマ
 */
export interface ProcessedRssArticle {
  /** RSSフィードのURL */
  feedUrl: string;
  /** RSS記事のGUID（グローバル一意識別子） */
  guid: string;
  /** 記事のスラッグ */
  slug: string;
  /** 処理完了日時 */
  processedAt: Timestamp;
  /** 作成されたPR番号（存在する場合） */
  prNumber: number | null;
  /** 作成されたPRのURL（存在する場合） */
  prUrl: string | null;
  /** 処理ステータス */
  status: 'success' | 'failed' | 'pending';
  /** エラーメッセージ（失敗時のみ） */
  errorMessage?: string;
  /** リトライ回数 */
  retryCount: number;
  /** 将来の拡張: イベントID */
  eventId?: string;
  /** 将来の拡張: リリースレベル */
  releaseLevel?: number;
  /** 将来の拡張: リリースタイプ */
  releaseTypes?: string[];
}

/**
 * 記事処理リクエスト（最小限の情報）
 */
export interface ArticleProcessRequest {
  feedUrl: string;
  guid: string;
  slug: string;
}

/**
 * 記事処理成功時の情報
 */
export interface ArticleProcessSuccess {
  prNumber: number;
  prUrl: string;
}

const COLLECTION_NAME = 'processed_rss_articles';
const MAX_RETRY_COUNT = 3;

/**
 * feedUrl + guid でドキュメントIDを生成（一意性保証）
 */
function generateDocId(feedUrl: string, guid: string): string {
  // URLとGUIDを組み合わせてBase64エンコード（Firebase Document IDとして安全）
  const combined = `${feedUrl}::${guid}`;
  return Buffer.from(combined).toString('base64').replace(/[/+=]/g, '_');
}

/**
 * 記事が既に処理済みかチェック
 *
 * @returns 処理済みの場合はドキュメントデータ、未処理の場合はnull
 */
export async function checkIfProcessed(
  feedUrl: string,
  guid: string
): Promise<ProcessedRssArticle | null> {
  const db = getAdminDb();
  const docId = generateDocId(feedUrl, guid);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as ProcessedRssArticle;
}

/**
 * 記事処理を開始（pendingステータスで記録）
 *
 * べき等性: 既にpendingまたはsuccessの場合は何もしない
 * failedの場合はリトライ回数をチェックして許可する
 */
export async function markAsPending(
  request: ArticleProcessRequest
): Promise<{ allowed: boolean; reason?: string }> {
  const db = getAdminDb();
  const docId = generateDocId(request.feedUrl, request.guid);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  const existing = await docRef.get();

  // 既に処理済み（success）
  if (existing.exists && existing.data()?.status === 'success') {
    return {
      allowed: false,
      reason: 'Already processed successfully',
    };
  }

  // 既に処理中（pending）
  if (existing.exists && existing.data()?.status === 'pending') {
    return {
      allowed: false,
      reason: 'Already being processed',
    };
  }

  // 失敗済みの場合、リトライ回数チェック
  if (existing.exists && existing.data()?.status === 'failed') {
    const retryCount = existing.data()?.retryCount || 0;
    if (retryCount >= MAX_RETRY_COUNT) {
      return {
        allowed: false,
        reason: `Max retry count (${MAX_RETRY_COUNT}) exceeded`,
      };
    }

    // リトライ許可 - retryCountをインクリメント
    await docRef.update({
      status: 'pending',
      retryCount: retryCount + 1,
      processedAt: Timestamp.now(),
    });

    return { allowed: true };
  }

  // 新規記事 - pendingで作成
  const newDoc: ProcessedRssArticle = {
    feedUrl: request.feedUrl,
    guid: request.guid,
    slug: request.slug,
    processedAt: Timestamp.now(),
    prNumber: null,
    prUrl: null,
    status: 'pending',
    retryCount: 0,
  };

  await docRef.set(newDoc);

  return { allowed: true };
}

/**
 * 記事処理が成功したことを記録
 */
export async function markAsSuccess(
  request: ArticleProcessRequest,
  success: ArticleProcessSuccess
): Promise<void> {
  const db = getAdminDb();
  const docId = generateDocId(request.feedUrl, request.guid);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    status: 'success',
    prNumber: success.prNumber,
    prUrl: success.prUrl,
    processedAt: Timestamp.now(),
  });
}

/**
 * 記事処理が失敗したことを記録
 */
export async function markAsFailed(
  request: ArticleProcessRequest,
  errorMessage: string
): Promise<void> {
  const db = getAdminDb();
  const docId = generateDocId(request.feedUrl, request.guid);
  const docRef = db.collection(COLLECTION_NAME).doc(docId);

  await docRef.update({
    status: 'failed',
    errorMessage,
    processedAt: Timestamp.now(),
  });
}

/**
 * 処理済み記事の一覧を取得（管理用）
 *
 * @param limit 取得件数上限
 * @param status フィルタリングするステータス（オプション）
 */
export async function listProcessedArticles(
  limit = 100,
  status?: 'success' | 'failed' | 'pending'
): Promise<ProcessedRssArticle[]> {
  const db = getAdminDb();
  let query = db
    .collection(COLLECTION_NAME)
    .orderBy('processedAt', 'desc')
    .limit(limit);

  if (status) {
    query = query.where('status', '==', status) as any;
  }

  const snapshot = await query.get();

  return snapshot.docs.map(doc => doc.data() as ProcessedRssArticle);
}
