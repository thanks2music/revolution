import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import iconv from 'iconv-lite';

import { extractFragment, fetchFragment } from '../src/fetch-fragment';

// DNS を引かないよう、IP リテラルの公開アドレス (TEST-NET ではなく実在の公開帯) を使う
const PUBLIC = 'https://93.184.215.14';

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
