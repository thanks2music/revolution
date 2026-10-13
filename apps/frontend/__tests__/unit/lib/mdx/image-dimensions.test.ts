import { getImageDimensions } from '@/lib/mdx/image-dimensions';

// 幅 2・高さ 3 の PNG の先頭 (IHDR まで読めれば寸法が分かる)
const PNG_2x3 = Uint8Array.from(
  Buffer.from(
    '89504E470D0A1A0A0000000D4948445200000002000000030806000000',
    'hex'
  )
);

describe('getImageDimensions', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('先頭のバイトだけを Range で取って寸法を読む', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(PNG_2x3, { status: 206 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(getImageDimensions('https://images.anime-events.com/t/a.png')).resolves.toEqual({
      width: 2,
      height: 3,
    });
    expect(fetchMock.mock.calls[0][1].headers.Range).toBe('bytes=0-65535');
  });

  it('64 KB で読めなければ 512 KB で取り直す', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 206 }))
      .mockResolvedValueOnce(new Response(PNG_2x3, { status: 206 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(getImageDimensions('https://images.anime-events.com/t/b.jpg')).resolves.toEqual({
      width: 2,
      height: 3,
    });
    expect(fetchMock.mock.calls[1][1].headers.Range).toBe('bytes=0-524287');
  });

  it('配信元が Range を無視して全体 (200) を返しても、先頭だけ読んで残りは捨てる', async () => {
    const big = new Uint8Array(200 * 1024);
    big.set(PNG_2x3, 0);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 16 KB ずつ流す。64 KB 読んだら止まるはず
        controller.enqueue(big.subarray(pulled, pulled + 16 * 1024));
        pulled += 16 * 1024;
        if (pulled >= big.length) controller.close();
      },
    });
    global.fetch = jest.fn().mockResolvedValue(new Response(body, { status: 200 })) as unknown as typeof fetch;
    await expect(getImageDimensions('https://images.anime-events.com/t/e.png')).resolves.toEqual({
      width: 2,
      height: 3,
    });
    expect(pulled).toBeLessThan(big.length);
  });

  it('取得に失敗したら null (記事は幅いっぱいで出す)', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(getImageDimensions('https://images.anime-events.com/t/c.jpg')).resolves.toBeNull();
  });

  it('自前でない URL は取りに行かない', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(getImageDimensions('https://example.com/d.jpg')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
