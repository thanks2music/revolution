import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ブラウザで動く部品が読むスキーマのファイルは、DB の表の定義 (drizzle) を読まない。
 * 読むと、表の定義までブラウザの bundle に載る (2026-11-23 に投稿のフォームとマイページで実際に載っていた)
 */
const CLIENT_SAFE = ['review-constants.ts', 'username.ts'];

describe('ブラウザで読むスキーマのファイル', () => {
  it.each(CLIENT_SAFE)('%s は drizzle と表の定義を import しない', file => {
    const source = readFileSync(
      path.join(__dirname, '../../../../../../shared/schemas', file),
      'utf8'
    );
    // 複数行の import も拾うため、`from '...'` をすべて見る
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]);
    expect(specifiers.filter(spec => spec.includes('drizzle') || spec.startsWith('./db/'))).toEqual(
      []
    );
  });
});
