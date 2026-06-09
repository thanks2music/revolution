import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 設定 (Crescendolls 会員機能)
 *
 * - schema: Drizzle テーブル定義は `@revolution/schemas` workspace の db/ に集約
 *   (Schema-SDD: frontend が import する真実源)。workspace パッケージのため
 *   相対パスで shared/schemas/db を指す。
 * - out: 生成 migration + custom SQL migration の出力先。
 * - dbCredentials.url: drizzle-kit は migration 生成/push に **session pooler (5432)**
 *   を使う。`MIGRATION_DATABASE_URL` を読む。ローカル検証時は inline env override で
 *   ローカル DB URL を渡す:
 *     MIGRATION_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
 *       pnpm exec drizzle-kit ...
 *
 * 注: remote (ref=abqsntbvnuttpyixagob) へ自律 migration は禁止 (ハーネス絶対制約)。
 *     ローカル `supabase start` の DB に対してのみ適用する。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: '../../shared/schemas/db/*.ts',
  out: './drizzle',
  dbCredentials: {
    // drizzle-kit (generate/push/migrate) は session pooler を使う。
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
  // public スキーマのみ管理対象。auth/storage 等 Supabase 管理スキーマは
  // introspect/diff の対象外にして誤操作を防ぐ。
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
});
