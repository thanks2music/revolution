import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

try {
  if (getApps().length === 0) {
    console.log('[Firebase Admin] Initializing Firebase Admin SDK...');

    // Cloud Run の GOOGLE_APPLICATION_CREDENTIALS_JSON から認証情報を取得
    let projectId: string;
    let clientEmail: string;
    let privateKey: string;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log('[Firebase Admin] Using GOOGLE_APPLICATION_CREDENTIALS_JSON');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      projectId = credentials.project_id;
      clientEmail = credentials.client_email;
      privateKey = credentials.private_key;
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      console.log('[Firebase Admin] Using individual environment variables');
      projectId = process.env.FIREBASE_PROJECT_ID;
      clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    } else {
      throw new Error(
        'Firebase Admin credentials not found. Set either GOOGLE_APPLICATION_CREDENTIALS_JSON or individual FIREBASE_* variables'
      );
    }

    console.log('[Firebase Admin] Project ID:', projectId);
    console.log('[Firebase Admin] Client Email:', clientEmail);
    console.log('[Firebase Admin] Private Key exists:', !!privateKey);

    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    console.log('[Firebase Admin] Firebase Admin SDK initialized successfully');
  } else {
    console.log('[Firebase Admin] Using existing Firebase Admin app');
    adminApp = getApps()[0];
  }

  adminAuth = getAuth(adminApp);
  adminDb = getFirestore(adminApp);

  console.log('[Firebase Admin] Firestore instance created');
} catch (error) {
  console.error('[Firebase Admin] Failed to initialize Firebase Admin SDK:', error);
  throw error;
}

export { adminApp, adminAuth, adminDb };