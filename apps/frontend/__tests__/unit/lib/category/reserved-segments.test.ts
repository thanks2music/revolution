import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  APP_ROUTE_SEGMENTS,
  findReservedSlugs,
  PUBLIC_DIR_SEGMENTS,
  REDIRECT_SEGMENTS,
} from '@/lib/category/reserved-segments';

/**
 * 予約語 (トップ階層の静的セグメント) の一覧を、実際の構成と照合する (Layer 1)。
 *
 * 一覧を手で持つ以上、ルートを足したのに一覧を直し忘れると、その名前の種別を
 * 作ったときにビルドで止められない。**構成と一覧のずれ自体をテストで落とす。**
 */

const FRONTEND_ROOT = path.resolve(__dirname, '../../../..');

/** ディレクトリ直下のサブディレクトリ名 (URL に現れないもの = `[x]` `(x)` `_x` `@x` を除く)。 */
function staticDirs(dir: string): string[] {
  return readdirSync(path.join(FRONTEND_ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !/^[[(_@]/.test(name))
    .sort();
}

/**
 * `app/` の第 1 階層の静的ルート。
 *
 * ⚠️ route group `(x)` は URL に現れないので、**`app/(x)/about/` の `about` も第 1 階層**になる。
 *    group の中まで見ないと、そこに足したルートを一覧に入れ忘れても通ってしまう。
 */
function topLevelRoutes(dir = 'app'): string[] {
  const groups = readdirSync(path.join(FRONTEND_ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
  return [
    ...new Set([...staticDirs(dir), ...groups.flatMap((group) => topLevelRoutes(group))]),
  ].sort();
}

describe('reserved segments', () => {
  it('app/ 直下の静的ルート (route group の中を含む) と一致する', () => {
    expect([...APP_ROUTE_SEGMENTS].sort()).toEqual(topLevelRoutes());
  });

  it('public/ 直下のディレクトリと一致する', () => {
    expect([...PUBLIC_DIR_SEGMENTS].sort()).toEqual(staticDirs('public'));
  });

  it('next.config.mjs の redirects() の第 1 セグメントと一致する', () => {
    const config = readFileSync(path.join(FRONTEND_ROOT, 'next.config.mjs'), 'utf8');
    const sources = [...config.matchAll(/source:\s*'\/([^/:']+)/g)].map((match) => match[1]);
    expect([...REDIRECT_SEGMENTS].sort()).toEqual([...new Set(sources)].sort());
  });
});

describe('findReservedSlugs', () => {
  it('静的ルートと重なる slug だけを返す', () => {
    expect(findReservedSlugs(['collabo-cafe', 'titles', 'post', 'images'])).toEqual([
      'titles',
      'post',
      'images',
    ]);
  });

  it('現行の 5 種別はどれも重ならない (2026-11-03)', () => {
    expect(
      findReservedSlugs(['collabo-cafe', 'pop-up-store', 'exhibition', 'chain-store', 'other']),
    ).toEqual([]);
  });
});
