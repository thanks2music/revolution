'use client';

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

import { env } from '@/lib/env';

/**
 * Firebase のクライアント SDK。読み込んだ時ではなく、最初に要った時に初期化する
 * (import しただけのテストなどが、設定の不足で落ちないように)。値の検証は lib/env.ts が持つ。
 */
let cachedApp: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;

  cachedApp =
    getApps()[0] ??
    initializeApp({
      apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });

  return cachedApp;
}

export const getFirebaseAuth = (): Auth => getAuth(getFirebaseApp());
export const getFirebaseDb = (): Firestore => getFirestore(getFirebaseApp());
