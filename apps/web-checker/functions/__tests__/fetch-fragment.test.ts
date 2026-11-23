import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import iconv from 'iconv-lite';

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { extractFragment, fetchFragment, guardedDispatcher, guardedLookup } from '../src/fetch-fragment';

// DNS を引かないよう、IP リテラルの公開アドレス (TEST-NET ではなく実在の公開帯) を使う
const PUBLIC = 'https://93.184.215.14';

const realFetch = global.fetch;

type FetchMock = jest.Mock<typeof fetch>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = jest.fn<typeof fetch>();
  global.fetch = fetchMock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });
}

describe('extractFragment', () => {
  it('セレクタに一致した最初の要素の中身を返す', () => {
    expect(extractFragment('<div id="a"><b>x</b></div><div id="a">y</div>', '#a')).toBe('<b>x</b>');
  });

  it('一致しなければ null', () => {
    expect(extractFragment('<p>x</p>', '#none')).toBeNull();
  });
});

describe('fetchFragment', () => {
  it('ページを取得して、抜き出す部分の HTML を返す', async () => {
    fetchMock.mockResolvedValue(html('<ul id="news"><li>A</li></ul>'));
    await expect(fetchFragment(`${PUBLIC}/news`, '#news')).resolves.toBe('<li>A</li>');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('Shift_JIS のページも読める', async () => {
    const body = iconv.encode('<ul id="news"><li>お知らせのページです。新しい企画が始まりました。</li></ul>', 'Shift_JIS');
    fetchMock.mockResolvedValue(new Response(new Uint8Array(body), { status: 200 }));
    await expect(fetchFragment(`${PUBLIC}/news`, '#news')).resolves.toContain('新しい企画');
  });

  it('内部アドレスは取得しない', async () => {
    await expect(fetchFragment('https://169.254.169.254/latest', 'body', { retryDelayMs: 0 })).rejects.toThrow(
      /Blocked host/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('外部から内部へのリダイレクトは追わない', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }));
    await expect(fetchFragment(`${PUBLIC}/`, 'body', { retryDelayMs: 0 })).rejects.toThrow(/Blocked host/);
  });

  it('http(s) 以外は取得しない', async () => {
    await expect(fetchFragment('file:///etc/passwd', 'body', { retryDelayMs: 0 })).rejects.toThrow(/Blocked URL scheme/);
  });

  it('失敗したら 3 回まで試す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(html('<p id="a">ok</p>'));
    await expect(fetchFragment(`${PUBLIC}/`, '#a', { retryDelayMs: 0 })).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('3 回とも失敗したら最後のエラーを投げる', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(fetchFragment(`${PUBLIC}/`, '#a', { retryDelayMs: 0 })).rejects.toThrow('HTTP 404');
  });

  it('大きすぎる本文は途中で読むのをやめる', async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    fetchMock.mockImplementation(() => Promise.resolve(new Response(big, { status: 200 })));
    await expect(fetchFragment(`${PUBLIC}/`, 'body', { retryDelayMs: 0 })).rejects.toThrow(/too large/);
  });
});

describe('guardedLookup (DNS rebinding)', () => {
  it('内部アドレスに解決される名前は、接続の名前解決で拒む', async () => {
    const error = await new Promise<Error | null>((resolve) =>
      guardedLookup('localhost', {}, (err) => resolve(err)),
    );
    expect(error?.message).toMatch(/resolves to internal address/);
  });

  describe('Node の fetch に dispatcher として渡した時', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((_req, res) => res.end('secret'));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('名前が内部アドレスに解決されたら接続しない', async () => {
      await expect(
        // @ts-expect-error -- Node の fetch は undici の dispatcher を受け付ける
        realFetch(`http://localhost:${port}/`, { dispatcher: guardedDispatcher }),
      ).rejects.toThrow();
    });

    it('dispatcher が無ければ接続できてしまう (上のテストが意味を持つことの確認)', async () => {
      await expect(realFetch(`http://localhost:${port}/`).then((r) => r.text())).resolves.toBe('secret');
    });
  });
});
