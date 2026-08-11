import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { fetchHtmlOrThrow } from '@/lib/utils/fetch-html';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

/** `fetch` の応答を最小限で差し替える。 */
function mockFetch(init: { ok: boolean; status: number; statusText?: string; body?: string }): void {
  global.fetch = jest.fn(async () => ({
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? '',
    text: async () => init.body ?? '',
  })) as unknown as typeof global.fetch;
}

describe('fetchHtmlOrThrow', () => {
  it('2xx なら本文を返す', async () => {
    mockFetch({ ok: true, status: 200, body: '<html>ok</html>' });

    await expect(fetchHtmlOrThrow('https://example.com/')).resolves.toBe('<html>ok</html>');
  });

  // ★ `fetch(url).then((r) => r.text())` は 404 でも resolve するため、
  //   404 ページの HTML が「正解データの入力」になり、`.place` 0 件の結果が
  //   「LTR 系以外のサイト構造」という別の原因に化けていた。
  it('404 は loud に落とす (404 ページを正解データの入力にしない)', async () => {
    mockFetch({ ok: false, status: 404, statusText: 'Not Found', body: '<html>404</html>' });

    await expect(fetchHtmlOrThrow('https://example.com/missing')).rejects.toThrow(/HTTP 404/);
  });

  it('5xx も同様に落とす', async () => {
    mockFetch({ ok: false, status: 503, statusText: 'Service Unavailable' });

    await expect(fetchHtmlOrThrow('https://example.com/')).rejects.toThrow(/HTTP 503/);
  });

  // ★ 7 巡目レビュー由来。失敗帰属を守るためのモジュールなので、タイムアウト経路も
  //   他と同じ扱いでカバーする。
  it('タイムアウトは「取得できなかった」と分かる文言で落とす', async () => {
    global.fetch = jest.fn(async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof global.fetch;

    await expect(fetchHtmlOrThrow('https://example.com/slow')).rejects.toThrow(
      /タイムアウト/
    );
  });

  it('タイムアウトのメッセージにも URL を含める', async () => {
    global.fetch = jest.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof global.fetch;

    await expect(fetchHtmlOrThrow('https://example.com/slow')).rejects.toThrow(
      /https:\/\/example\.com\/slow/
    );
  });

  it('AbortError 以外のネットワークエラーはそのまま伝播する', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof global.fetch;

    await expect(fetchHtmlOrThrow('https://example.com/')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('ブラウザライクな User-Agent を付けて取得する (bot ブロックを避ける)', async () => {
    mockFetch({ ok: true, status: 200, body: 'ok' });

    await fetchHtmlOrThrow('https://example.com/');

    const init = (global.fetch as unknown as jest.Mock).mock.calls[0][1];
    expect(String(init.headers['User-Agent'])).toContain('Mozilla/5.0');
  });

  it('エラーメッセージに URL を含める (どの取得が失敗したか分かるように)', async () => {
    mockFetch({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(fetchHtmlOrThrow('https://example.com/typo')).rejects.toThrow(
      /https:\/\/example\.com\/typo/
    );
  });
});
