import { describe, expect, it } from '@jest/globals';

import { classifyFetchError, pageNamesWork, probeOfficialSite } from '@/lib/archive-source/probe-official';

const page = (raw: string) => async () => ({ compacted: raw, raw });
const failing = (message: string) => async () => {
  throw new Error(message);
};

describe('classifyFetchError', () => {
  it('reads the HTTP status, timeouts and the rest', () => {
    expect(classifyFetchError('コンテンツHTMLの取得に失敗: https://a/ - HTTP error! status: 404 Not Found')).toBe('http-404');
    expect(classifyFetchError('コンテンツHTMLのフェッチがタイムアウトしました: https://a/ (10000ms)')).toBe('timeout');
    expect(classifyFetchError('コンテンツHTMLの取得に失敗: https://a/ - fetch failed')).toBe('unreachable');
  });
});

describe('pageNamesWork', () => {
  it('ignores width, case, spaces and punctuation', () => {
    expect(pageNamesWork('<h1>「ＳＡＭＰＬＥ　Ｗｏｒｋ！」コラボ</h1>', 'Sample Work!')).toBe(true);
    expect(pageNamesWork('<p>サンプル・作品</p>', 'サンプル作品')).toBe(true);
  });

  it('does not match text inside scripts and styles', () => {
    expect(pageNamesWork('<script>var t="Sample Work"</script><p>other event</p>', 'Sample Work')).toBe(false);
  });

  it('cannot check an empty title, so treats it as named', () => {
    expect(pageNamesWork('<p>anything</p>', ' ')).toBe(true);
  });
});

describe('probeOfficialSite', () => {
  it('is alive when the page names the work', async () => {
    expect(await probeOfficialSite('https://official.example.com/', 'Sample Work', page('<p>Sample Work cafe</p>'))).toEqual({
      status: 'alive',
    });
  });

  it('is gone when the URL now shows another event', async () => {
    const probe = await probeOfficialSite('https://official.example.com/', 'Sample Work', page('<p>Another title</p>'));
    expect(probe).toEqual(expect.objectContaining({ status: 'gone', reason: 'title-mismatch' }));
  });

  it('is gone when the fetch fails, with the reason', async () => {
    const probe = await probeOfficialSite(
      'https://official.example.com/',
      'Sample Work',
      failing('コンテンツHTMLの取得に失敗: https://official.example.com/ - HTTP error! status: 403 Forbidden'),
    );
    expect(probe).toEqual({
      status: 'gone',
      reason: 'http-403',
      detail: 'コンテンツHTMLの取得に失敗: https://official.example.com/ - HTTP error! status: 403 Forbidden',
    });
  });
});
