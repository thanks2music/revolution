'use client';

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

let cachedApp: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;

  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  // Validate configuration - all fields are required
  const missing = Object.entries(config)
    .filter(([_, v]) => v === undefined || v === null || v === '')
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Firebase configuration is incomplete. Missing environment variables: ${missing.join(', ')}. ` +
      `Please ensure all NEXT_PUBLIC_FIREBASE_* variables are set.`
    );
  }

  if (getApps().length === 0) {
    cachedApp = initializeApp(config);
  } else {
    cachedApp = getApps()[0];
  }

  return cachedApp;
}

export const getFirebaseAuth = (): Auth => getAuth(getFirebaseApp());
export const getFirebaseDb = (): Firestore => getFirestore(getFirebaseApp());
export const getFirebaseStorage = (): FirebaseStorage => getStorage(getFirebaseApp());