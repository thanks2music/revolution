import { describe, expect, it } from '@jest/globals';

import { classifyFetchError, pageNamesWork, probeOfficialSite, siteUnreachable } from '@/lib/archive-source/probe-official';

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

  it('reads the title from image alt / title texts and og:title (logo-only pages)', () => {
    expect(pageNamesWork('<h1><img src="/logo.png" alt="サンプル作品 コラボカフェ"></h1>', 'サンプル作品')).toBe(true);
    expect(pageNamesWork('<a title="Sample Work"><img src="/logo.png"></a>', 'Sample Work')).toBe(true);
    expect(pageNamesWork('<meta property="og:title" content="サンプル作品 POP UP"><p>no text</p>', 'サンプル作品')).toBe(true);
    expect(pageNamesWork('<img src="/logo.png" alt="other event">', 'サンプル作品')).toBe(false);
  });

  it('cannot check an empty title, so treats it as named', () => {
    expect(pageNamesWork('<p>anything</p>', ' ')).toBe(true);
  });
});

describe('probeOfficialSite retries', () => {
  it('tries once more after a timeout or a 5xx and uses the second answer', async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('コンテンツHTMLの取得に失敗: https://a/ - HTTP error! status: 503 Service Unavailable');
      return { compacted: '<p>Sample Work</p>', raw: '<p>Sample Work</p>' };
    };
    expect(await probeOfficialSite('https://official.example.com/', 'Sample Work', flaky)).toEqual({ status: 'alive' });
    expect(calls).toBe(2);
  });

  it('does not retry a 404 or an unreachable site', async () => {
    let calls = 0;
    const missing = async () => {
      calls += 1;
      throw new Error('コンテンツHTMLの取得に失敗: https://a/ - HTTP error! status: 404 Not Found');
    };
    expect(await probeOfficialSite('https://official.example.com/', 'Sample Work', missing)).toEqual(
      expect.objectContaining({ status: 'gone', reason: 'http-404' }),
    );
    expect(calls).toBe(1);
  });
});

describe('siteUnreachable', () => {
  it('is true only when the whole site cannot be reached', () => {
    expect(siteUnreachable('unreachable')).toBe(true);
    expect(siteUnreachable('timeout')).toBe(true);
    expect(siteUnreachable('http-404')).toBe(false);
    expect(siteUnreachable('title-mismatch')).toBe(false);
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
