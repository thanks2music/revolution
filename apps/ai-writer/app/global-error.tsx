/**
 * Global Error Boundary
 *
 * root layout 自体が throw した場合に、layout ごと置き換わって描画される。
 * そのため `<html>` / `<body>` を自前で持つ必要があり、globals.css も適用されない前提で
 * **inline style のみ**で組む (Tailwind クラスに依存しない)。
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/error#global-error
 */

'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        <main style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            エラーが発生しました
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>
            アプリケーションの読み込みに失敗しました。時間をおいて再度お試しください。
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '1rem' }}>
              Error ID: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
