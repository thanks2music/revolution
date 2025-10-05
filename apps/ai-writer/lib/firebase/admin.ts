import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;

try {
  if (getApps().length === 0) {
    console.log('[Firebase Admin] Initializing Firebase Admin SDK...');
    console.log('[Firebase Admin] Project ID:', process.env.FIREBASE_PROJECT_ID);
    console.log('[Firebase Admin] Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
    console.log('[Firebase Admin] Private Key exists:', !!process.env.FIREBASE_PRIVATE_KEY);

    if (!process.env.FIREBASE_PROJECT_ID) {
      throw new Error('FIREBASE_PROJECT_ID is not set');
    }
    if (!process.env.FIREBASE_CLIENT_EMAIL) {
      throw new Error('FIREBASE_CLIENT_EMAIL is not set');
    }
    if (!process.env.FIREBASE_PRIVATE_KEY) {
      throw new Error('FIREBASE_PRIVATE_KEY is not set');
    }

    adminApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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