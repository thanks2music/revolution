/**
 * Drizzle migration ランナー (Crescendolls 会員機能)
 *
 * drizzle-orm の migrate() で `drizzle/` 配下の migration (生成 SQL + custom SQL) を
 * 適用する。migration は **Session pooler (5432)** を使い、prepared statement の
 * 衝突を避けるため `max: 1` (単一接続) で実行する。これは Drizzle 公式の migration 推奨設定。
 *
 * - 接続文字列は `MIGRATION_DATABASE_URL` を読む。ローカル検証時は inline override:
 *     MIGRATION_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
 *       pnpm exec tsx lib/db/migrate.ts
 * - remote (ref=abqsntbvnuttpyixagob) へ自律適用は禁止 (ハーネス絶対制約)。
 *   ローカル `supabase start` の DB に対してのみ適用する。
 * - migrationsFolder は drizzle.config.ts の `out` と一致させる。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = './drizzle';

export async function runMigrations(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Supabase Session pooler (5432) の接続文字列を指定してください ' +
        '(ローカル検証時は inline env override でローカル DB URL を渡す)。',
    );
  }

  // migration は単一接続 (max: 1)。prepare:false は postgres-js のデフォルト挙動を
  // 尊重しつつ、pooler 経由でも安全に流せるよう明示する。
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}

// CLI から直接実行された場合は migration を流す (`tsx lib/db/migrate.ts`)。
// import 経由 (テスト等) では自動実行しない。
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /lib\/db\/migrate\.ts$/.test(process.argv[1]);

if (isMain) {
  runMigrations()
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration failed:', err);
      process.exit(1);
    });
}
