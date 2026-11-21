import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * 結合テストと E2E が接続する、ローカルの Supabase の接続情報。
 *
 * ## 値の取り方
 *
 * 1. 環境変数 `LOCAL_SUPABASE_URL` / `LOCAL_SUPABASE_PUBLISHABLE_KEY` / `LOCAL_SUPABASE_SECRET_KEY` /
 *    `LOCAL_SUPABASE_DB_URL` がそろっていれば、それを使う (CI はこちら。`supabase status` の値を入れる)
 * 2. そろっていなければ `supabase status -o json` を `apps/frontend` で実行して読む (手元)
 *
 * アプリの `.env.local` は読まない。`pnpm dev:stg` のように staging を向いた値が入っていても、
 * テストが staging や本番に書き込まないようにするため。
 *
 * ## ローカル以外を拒む
 *
 * テストは会員を作り、開催を書き込み、最後に消す。API の URL と Postgres の接続文字列のどちらかのホストが `127.0.0.1` / `localhost` でなければ
 * 例外を投げて止める (取り違えた値で本物の DB を書き換えないための安全網)。
 *
 * 見るのはホスト名だけ。`localhost` へ SSH のトンネルを張って本物の DB につないだ時のように、
 * ホスト名がローカルでも中身がローカルでない場合は防げない。`::1` も通さない (安全な側に倒している)。
 */
export type LocalSupabaseEnv = {
  url: string;
  publishableKey: string;
  secretKey: string;
  /** Postgres の接続文字列 (Drizzle の `DATABASE_URL` に渡す) */
  dbUrl: string;
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

let cached: LocalSupabaseEnv | undefined;

export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  if (cached) return cached;

  const fromEnv = readLocalSupabaseEnvVars(process.env);
  const resolved = fromEnv ?? readFromSupabaseCli();
  assertLocalUrl(resolved.url);
  assertLocalUrl(resolved.dbUrl);

  cached = resolved;
  return resolved;
}

const ENV_NAMES = {
  url: 'LOCAL_SUPABASE_URL',
  publishableKey: 'LOCAL_SUPABASE_PUBLISHABLE_KEY',
  secretKey: 'LOCAL_SUPABASE_SECRET_KEY',
  dbUrl: 'LOCAL_SUPABASE_DB_URL',
} as const satisfies Record<keyof LocalSupabaseEnv, string>;

/**
 * 環境変数から接続情報を読む。1 つも無ければ undefined (`supabase status` から読む)。
 * 一部だけある時は、黙って `supabase status` に切り替えず、足りない名前を挙げて止める。
 */
export function readLocalSupabaseEnvVars(
  vars: Record<string, string | undefined>,
): LocalSupabaseEnv | undefined {
  const entries = Object.entries(ENV_NAMES) as Array<[keyof LocalSupabaseEnv, string]>;
  const missing = entries.filter(([, name]) => !vars[name]).map(([, name]) => name);

  if (missing.length === entries.length) return undefined;
  if (missing.length > 0) {
    throw new Error(`ローカルの Supabase の環境変数が足りません: ${missing.join(' / ')}`);
  }
  return Object.fromEntries(entries.map(([key, name]) => [key, vars[name]])) as LocalSupabaseEnv;
}

function readFromSupabaseCli(): LocalSupabaseEnv {
  let raw: string;
  try {
    raw = execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: frontendRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'ローカルの Supabase に接続できません。apps/frontend で `supabase start` を実行してください' +
        ` (または ${Object.values(ENV_NAMES).join(' / ')} を設定する)`,
    );
  }

  const status = JSON.parse(raw) as Record<string, string | undefined>;
  const url = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY;
  const secretKey = status.SECRET_KEY;
  const dbUrl = status.DB_URL;
  if (!url || !publishableKey || !secretKey || !dbUrl) {
    throw new Error(
      '`supabase status -o json` に API_URL / PUBLISHABLE_KEY / SECRET_KEY / DB_URL がありません。Supabase CLI を更新してください',
    );
  }
  return { url, publishableKey, secretKey, dbUrl };
}

/** 接続先のホストがローカルでなければ例外を投げる (ファイル冒頭の「ローカル以外を拒む」) */
export function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // 値に秘密 (DB のパスワード) が入りうるので、エラーには値を出さない
    throw new Error('ローカルの Supabase の接続先が URL として読めません (パスワードの記号のエスケープ漏れなど)');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `テストはローカルの Supabase にだけ接続します。接続先のホストが ${host} だったため止めました`,
    );
  }
}

/** `apps/frontend` の絶対パス (`supabase/config.toml` がある所)。どこから起動しても同じ所を指す */
function frontendRoot(): string {
  return path.resolve(__dirname, '..');
}
