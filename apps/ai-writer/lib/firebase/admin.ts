import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

// グローバルスコープでシングルトンをキャッシュ
// Note: 本番（Cloud Run）では module-scoped let で十分だが、
// 開発環境の HMR 対応のため globalThis を使用
const globalForFirebase = globalThis as unknown as {
  adminApp: App | undefined;
  adminAuth: Auth | undefined;
  adminDb: Firestore | undefined;
};

function getAdminApp(): App {
  // 既に初期化済みの場合は再利用
  if (globalForFirebase.adminApp) {
    return globalForFirebase.adminApp;
  }

  // Firebase SDK が既にアプリを持っている場合（稀）
  if (getApps().length > 0) {
    console.log('[Firebase Admin] Using existing Firebase Admin app');
    globalForFirebase.adminApp = getApp();
    return globalForFirebase.adminApp;
  }

  console.log('[Firebase Admin] Initializing Firebase Admin SDK...');

  // 認証情報取得（2パターン + 将来の ADC 対応準備）
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;

  // Pattern 1: JSON形式（現在の Secret Manager 設定）
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    console.log('[Firebase Admin] Using GOOGLE_APPLICATION_CREDENTIALS_JSON');
    try {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      projectId = credentials.project_id;
      clientEmail = credentials.client_email;
      privateKey = credentials.private_key;

      // 値の検証
      if (!projectId || !clientEmail || !privateKey) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is missing required fields');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${errMsg}`);
    }
  }
  // Pattern 2: 個別環境変数
  else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    console.log('[Firebase Admin] Using individual environment variables');
    projectId = process.env.FIREBASE_PROJECT_ID;
    clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  // 認証情報が見つからない場合
  else {
    const errorMessage = 'Firebase Admin credentials not found. Set either GOOGLE_APPLICATION_CREDENTIALS_JSON or individual FIREBASE_* variables';

    // CI/Development環境では警告のみ（ビルドは続行）
    if (process.env.NODE_ENV !== 'production' || process.env.CI === 'true') {
      console.warn(`[Firebase Admin] ${errorMessage} (non-production/CI environment)`);
      // ビルド時は初期化をスキップし、ランタイムで再度試行
      throw new Error(`${errorMessage} (expected in development/CI build)`);
    }

    // 本番環境では致命的エラー
    throw new Error(errorMessage);
  }

  console.log('[Firebase Admin] Project ID:', projectId);
  console.log('[Firebase Admin] Client Email:', clientEmail);
  console.log('[Firebase Admin] Private Key exists:', !!privateKey);

  try {
    globalForFirebase.adminApp = initializeApp({
      credential: cert({
        projectId: projectId!,
        clientEmail: clientEmail!,
        privateKey: privateKey!,
      }),
    });

    console.log('[Firebase Admin] Firebase Admin SDK initialized successfully');
    return globalForFirebase.adminApp;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize Firebase Admin SDK: ${errMsg}`);
  }
}

export function getAdminAuth(): Auth {
  if (globalForFirebase.adminAuth) {
    return globalForFirebase.adminAuth;
  }
  const app = getAdminApp();
  globalForFirebase.adminAuth = getAuth(app);
  console.log('[Firebase Admin] Auth instance created');
  return globalForFirebase.adminAuth;
}

export function getAdminDb(): Firestore {
  if (globalForFirebase.adminDb) {
    return globalForFirebase.adminDb;
  }
  const app = getAdminApp();
  globalForFirebase.adminDb = getFirestore(app);
  console.log('[Firebase Admin] Firestore instance created');
  return globalForFirebase.adminDb;
}
