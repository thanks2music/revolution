/**
 * Drizzle ランタイムクライアント (Crescendolls 会員機能)
 *
 * postgres-js + drizzle-orm。Supabase の Transaction pooler (6543) 経由で接続する
 * 想定のため、pgbouncer transaction mode と非互換な prepared statement を無効化する
 * (`prepare: false`)。これは Supabase/Drizzle 公式の推奨設定。
 *
 * - 接続文字列は `DATABASE_URL` を読む。ローカル検証時は inline env override で
 *   ローカル DB URL を渡す:
 *     DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' <cmd>
 * - Server Action / Route Handler (= Server 専用) からのみ import すること。
 *   ブラウザバンドルに混入しないよう、本モジュールは公開キーを一切参照しない。
 * - テーブル定義は `@revolution/schemas` の db/ から import (Schema-SDD 真実源)。
 *
 * 注: RLS は接続するロール (authenticated/anon) に対して効く。Server Action から
 *     RLS を効かせるには別途 Supabase クライアント (createClient) 経由のアクセスや
 *     JWT claims 設定が必要。本 Drizzle クライアントは migration/管理用途・
 *     RLS バイパスが許容される secret-key 相当の文脈で使う想定 (M2 以降で利用箇所が確定)。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { favorites } from '@revolution/schemas/db/favorites';
import { profiles } from '@revolution/schemas/db/profiles';

/** Drizzle が参照するスキーマ (テーブル定義の集約)。 */
export const schema = { profiles, favorites };

/**
 * ランタイム接続を生成する。`DATABASE_URL` 未設定時は明示的に throw して
 * 配線ミスを早期検知する (build 時に評価されないよう関数化)。
 */
function createConnectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Supabase Transaction pooler (6543) の接続文字列を指定してください ' +
        '(ローカル検証時は inline env override でローカル DB URL を渡す)。',
    );
  }
  return url;
}

/**
 * Drizzle クライアントを生成する。`prepare: false` で pgbouncer transaction mode に対応。
 * 利用箇所で一度生成して使い回す想定 (モジュールトップで生成すると build 時に
 * env が無くても評価されてしまうため遅延生成にする)。
 */
export function createDb() {
  const sql = postgres(createConnectionUrl(), { prepare: false });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
