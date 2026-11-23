/**
 * 環境変数の型と検証 (apps/frontend などと同じく @t3-oss/env-nextjs)。
 *
 * `output: 'export'` なので、値はビルドの時にバンドルへ焼き込まれる。環境ごとにビルドする。
 * NEXT_PUBLIC_FIREBASE_* が公開されるのは Firebase の前提どおり (apiKey は秘密ではなく、プロジェクトを
 * 指す値)。データを守るのは Firestore の rules。
 */

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const required = (name: string) => z.string().min(1, { message: `${name} を設定してください` });

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },

  /*
   * Firebase の 6 つはすべて必須。1 つでも欠けると initializeApp が中途半端に成功し、
   * 実行するまで気付けないので、ビルドで落とす。
   */
  client: {
    NEXT_PUBLIC_FIREBASE_API_KEY: required('NEXT_PUBLIC_FIREBASE_API_KEY'),
    // signInWithPopup はこのドメインの /__/auth/handler を使う。間違えると Google のログインが失敗する
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: required('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: required('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: required('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: required('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    NEXT_PUBLIC_FIREBASE_APP_ID: required('NEXT_PUBLIC_FIREBASE_APP_ID'),
  },

  // クライアントの値は、Next.js が静的に置き換えられるように 1 つずつ書く
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  },

  // "false" という文字列で検証が外れないよう、真の値は厳密に比べる。CI ではダミーの値を渡してビルドする
  // (外すと runtimeEnv の書き漏れに気付けない)
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === 'true' || process.env.SKIP_ENV_VALIDATION === '1',

  emptyStringAsUndefined: true,
});
