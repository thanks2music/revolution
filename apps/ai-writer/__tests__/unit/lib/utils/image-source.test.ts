import { describe, expect, it } from '@jest/globals';
import * as cheerio from 'cheerio';

import { imageSource, repairImageSrc } from '@/lib/utils/image-source';

describe('repairImageSrc', () => {
  it('閉じ引用符が無く、続く HTML が入り込んだ src を、URL の部分で切る', () => {
    expect(repairImageSrc('img/item/a_09.jpg?0></a></center><BR><B>品名</B><BR><font size=')).toBe('img/item/a_09.jpg?0');
  });

  it('空白を含むファイル名では切らない (LTR の画像に実例あり)', () => {
    expect(repairImageSrc('https://images.example.com/cafe/BANANA RUSH.jpg')).toBe('https://images.example.com/cafe/BANANA RUSH.jpg');
  });

  it('壊れていない src はそのまま返す', () => {
    expect(repairImageSrc('https://example.com/img/a.jpg?w=100&h=200')).toBe('https://example.com/img/a.jpg?w=100&h=200');
  });
});

describe('imageSource', () => {
  it('壊れた src も直して返す (閉じ引用符の無い img)', () => {
    const $ = cheerio.load('<a href="img/a_09.jpg?0"><img src="img/a_09.jpg?0></a><B>品名</B><span class="x"></a>');

    expect(imageSource($('img').first())).toBe('img/a_09.jpg?0');
  });

  it('遅延読み込みの data: のダミーより data-src を使う', () => {
    const $ = cheerio.load('<img src="data:image/gif;base64,R0lGOD" data-src="img/real.jpg">');

    expect(imageSource($('img').first())).toBe('img/real.jpg');
  });
});
