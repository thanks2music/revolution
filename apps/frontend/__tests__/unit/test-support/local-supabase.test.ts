import { describe, expect, it } from '@jest/globals';

import { assertLocalUrl, readLocalSupabaseEnvVars } from '@/test-support/local-supabase';

/**
 * 結合テストと E2E がローカル以外の DB を書き換えないための安全網。
 * テストは service role のキーで行を作って消すので、この判定が緩むと本物のデータを消しうる。
 */
describe('assertLocalUrl', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ])('ローカルの接続先 %s は通す', (url) => {
    expect(() => assertLocalUrl(url)).not.toThrow();
  });

  it.each([
    'https://abcdefghijklmnop.supabase.co',
    'postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
    'http://[::1]:54321',
  ])('ローカル以外の接続先 %s は拒む', (url) => {
    expect(() => assertLocalUrl(url)).toThrow(/ローカルの Supabase にだけ接続します/);
  });

  it('URL として読めない値は、どの値かが分かるエラーで止める', () => {
    expect(() => assertLocalUrl('not a url')).toThrow(/URL として読めません/);
  });
});

describe('readLocalSupabaseEnvVars', () => {
  const all = {
    LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
    LOCAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    LOCAL_SUPABASE_SECRET_KEY: 'sb_secret_x',
    LOCAL_SUPABASE_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  };

  it('4 つそろっていれば、その値を使う', () => {
    expect(readLocalSupabaseEnvVars(all)).toEqual({
      url: all.LOCAL_SUPABASE_URL,
      publishableKey: all.LOCAL_SUPABASE_PUBLISHABLE_KEY,
      secretKey: all.LOCAL_SUPABASE_SECRET_KEY,
      dbUrl: all.LOCAL_SUPABASE_DB_URL,
    });
  });

  it('1 つも無ければ undefined (supabase status から読む)', () => {
    expect(readLocalSupabaseEnvVars({})).toBeUndefined();
  });

  it('一部だけ設定されていたら、足りない名前を挙げて止める', () => {
    const { LOCAL_SUPABASE_DB_URL: _omitted, ...partial } = all;
    expect(() => readLocalSupabaseEnvVars(partial)).toThrow(/LOCAL_SUPABASE_DB_URL/);
  });
});
