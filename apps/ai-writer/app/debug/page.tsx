'use client';

import { useAuth } from '../../lib/auth/auth-context';
import { getFirebaseAuth } from '../../lib/firebase/client';
import { useEffect, useState } from 'react';

export default function DebugPage() {
  const { user, loading } = useAuth();
  const [cookies, setCookies] = useState<string>('');
  const [localStorage, setLocalStorage] = useState<Record<string, string>>({});
  const [firebaseConfig, setFirebaseConfig] = useState<any>(null);

  useEffect(() => {
    setCookies(document.cookie);

    const storage: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) {
        storage[key] = window.localStorage.getItem(key) || '';
      }
    }
    setLocalStorage(storage);

    // Firebase App の設定を取得（lazy initialization）
    try {
      const auth = getFirebaseAuth();
      setFirebaseConfig({
        name: auth.app.name,
        options: auth.app.options,
      });
    } catch (error) {
      console.error('Firebase initialization error:', error);
      setFirebaseConfig({ error: String(error) });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold mb-8">認証デバッグ情報</h1>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Firebase Config (環境変数)</h2>
            <div className="space-y-2 text-sm">
              <p><strong>NEXT_PUBLIC_FIREBASE_API_KEY:</strong> {process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? '✅ Set' : '❌ Missing'}</p>
              <p><strong>NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:</strong> {process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '❌ Missing'}</p>
              <p><strong>NEXT_PUBLIC_FIREBASE_PROJECT_ID:</strong> {process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '❌ Missing'}</p>
              <p><strong>NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:</strong> {process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '❌ Missing'}</p>
              <p><strong>NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:</strong> {process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '❌ Missing'}</p>
              <p><strong>NEXT_PUBLIC_FIREBASE_APP_ID:</strong> {process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '❌ Missing'}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Firebase App 初期化状態</h2>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
              {firebaseConfig ? JSON.stringify(firebaseConfig, null, 2) : 'Loading...'}
            </pre>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">useAuth() 状態</h2>
            <div className="space-y-2">
              <p><strong>Loading:</strong> {loading ? 'true' : 'false'}</p>
              <p><strong>User:</strong> {user ? user.email : 'null'}</p>
              <p><strong>UID:</strong> {user?.uid || 'null'}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Firebase Auth 直接確認</h2>
            <div className="space-y-2">
              <p><strong>currentUser:</strong> {getFirebaseAuth().currentUser?.email || 'null'}</p>
              <p><strong>currentUser UID:</strong> {getFirebaseAuth().currentUser?.uid || 'null'}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Cookies</h2>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
              {cookies || 'No cookies'}
            </pre>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">LocalStorage</h2>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
              {JSON.stringify(localStorage, null, 2)}
            </pre>
          </div>
        </div>

        <div className="mt-8">
          <a href="/" className="text-blue-600 hover:underline">
            ← ダッシュボードに戻る
          </a>
        </div>
      </div>
    </div>
  );
}