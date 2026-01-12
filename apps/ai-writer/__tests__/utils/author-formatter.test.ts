/**
 * @fileoverview Unit Tests for Author Name Type Guard Functions (v1.4.0)
 *
 * @description
 * 複数原作者対応のType Guard関数群のユニットテスト。
 * カバレッジ目標: 90%以上
 *
 * @see /apps/ai-writer/lib/utils/author-formatter.ts
 * @since v1.4.0
 */

import {
  formatAuthorName,
  hasMultipleAuthors,
  getAuthorNamesAsArray,
  isString,
  isArray,
} from '../../lib/utils/author-formatter';

describe('author-formatter utilities', () => {
  describe('formatAuthorName', () => {
    describe('単一原作者の場合', () => {
      it('文字列をそのまま返すこと', () => {
        const result = formatAuthorName('尾田栄一郎先生');
        expect(result).toBe('尾田栄一郎先生');
      });

      it('空文字列の場合でもそのまま返すこと', () => {
        const result = formatAuthorName('');
        expect(result).toBe('');
      });
    });

    describe('複数原作者の場合', () => {
      it('配列を " / " で結合すること', () => {
        const result = formatAuthorName(['CLAMP先生', '新條まゆ先生']);
        expect(result).toBe('CLAMP先生 / 新條まゆ先生');
      });

      it('3人以上の原作者を正しく結合すること', () => {
        const result = formatAuthorName(['田中先生', '佐藤先生', '鈴木先生']);
        expect(result).toBe('田中先生 / 佐藤先生 / 鈴木先生');
      });

      it('1人だけの配列の場合はセパレーターなしで返すこと', () => {
        const result = formatAuthorName(['尾田栄一郎先生']);
        expect(result).toBe('尾田栄一郎先生');
      });

      it('空配列の場合は空文字列を返すこと', () => {
        const result = formatAuthorName([]);
        expect(result).toBe('');
      });
    });

    describe('null の場合', () => {
      it('空文字列を返すこと', () => {
        const result = formatAuthorName(null);
        expect(result).toBe('');
      });
    });

    describe('セパレーター仕様', () => {
      it('原作者名は常に " / " で結合すること（固定セパレーター）', () => {
        const result = formatAuthorName(['著者A', '著者B']);
        expect(result).toContain(' / ');
        expect(result).not.toContain('・');
      });
    });
  });

  describe('hasMultipleAuthors', () => {
    describe('複数原作者の場合', () => {
      it('2人以上の配列の場合は true を返すこと', () => {
        expect(hasMultipleAuthors(['CLAMP先生', '新條まゆ先生'])).toBe(true);
      });

      it('3人の配列の場合も true を返すこと', () => {
        expect(hasMultipleAuthors(['田中先生', '佐藤先生', '鈴木先生'])).toBe(true);
      });
    });

    describe('単一原作者の場合', () => {
      it('文字列の場合は false を返すこと', () => {
        expect(hasMultipleAuthors('尾田栄一郎先生')).toBe(false);
      });

      it('1人だけの配列の場合は false を返すこと', () => {
        expect(hasMultipleAuthors(['尾田栄一郎先生'])).toBe(false);
      });

      it('空配列の場合は false を返すこと', () => {
        expect(hasMultipleAuthors([])).toBe(false);
      });
    });

    describe('null の場合', () => {
      it('false を返すこと', () => {
        expect(hasMultipleAuthors(null)).toBe(false);
      });
    });
  });

  describe('getAuthorNamesAsArray', () => {
    describe('文字列の場合', () => {
      it('1要素の配列に変換すること', () => {
        const result = getAuthorNamesAsArray('尾田栄一郎先生');
        expect(result).toEqual(['尾田栄一郎先生']);
        expect(result).toHaveLength(1);
      });

      it('空文字列の場合は空配列を返すこと（falsy扱い）', () => {
        const result = getAuthorNamesAsArray('');
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });
    });

    describe('配列の場合', () => {
      it('そのまま返すこと', () => {
        const input = ['CLAMP先生', '新條まゆ先生'];
        const result = getAuthorNamesAsArray(input);
        expect(result).toEqual(input);
        expect(result).toBe(input); // 同一参照であることも確認
      });

      it('空配列の場合もそのまま返すこと', () => {
        const input: string[] = [];
        const result = getAuthorNamesAsArray(input);
        expect(result).toEqual([]);
        expect(result).toBe(input);
      });
    });

    describe('null の場合', () => {
      it('空配列を返すこと', () => {
        const result = getAuthorNamesAsArray(null);
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });
    });
  });

  describe('isString (Type Guard)', () => {
    describe('文字列の場合', () => {
      it('true を返すこと', () => {
        expect(isString('尾田栄一郎先生')).toBe(true);
      });

      it('空文字列の場合も true を返すこと', () => {
        expect(isString('')).toBe(true);
      });
    });

    describe('配列の場合', () => {
      it('false を返すこと', () => {
        expect(isString(['CLAMP先生'])).toBe(false);
      });

      it('空配列の場合も false を返すこと', () => {
        expect(isString([])).toBe(false);
      });
    });

    describe('null の場合', () => {
      it('false を返すこと', () => {
        expect(isString(null)).toBe(false);
      });
    });

    describe('Type Narrowing（型絞り込み）', () => {
      it('if 文で型を string に絞り込めること', () => {
        const name: string | string[] | null = '尾田栄一郎先生';
        if (isString(name)) {
          // この中では name は string 型として扱える
          const upperCase: string = name.toUpperCase();
          expect(upperCase).toBe('尾田栄一郎先生');
        } else {
          fail('isString should return true for string');
        }
      });
    });
  });

  describe('isArray (Type Guard)', () => {
    describe('配列の場合', () => {
      it('true を返すこと', () => {
        expect(isArray(['CLAMP先生', '新條まゆ先生'])).toBe(true);
      });

      it('空配列の場合も true を返すこと', () => {
        expect(isArray([])).toBe(true);
      });

      it('1要素の配列の場合も true を返すこと', () => {
        expect(isArray(['尾田栄一郎先生'])).toBe(true);
      });
    });

    describe('文字列の場合', () => {
      it('false を返すこと', () => {
        expect(isArray('尾田栄一郎先生')).toBe(false);
      });

      it('空文字列の場合も false を返すこと', () => {
        expect(isArray('')).toBe(false);
      });
    });

    describe('null の場合', () => {
      it('false を返すこと', () => {
        expect(isArray(null)).toBe(false);
      });
    });

    describe('Type Narrowing（型絞り込み）', () => {
      it('if 文で型を string[] に絞り込めること', () => {
        const name: string | string[] | null = ['CLAMP先生', '新條まゆ先生'];
        if (isArray(name)) {
          // この中では name は string[] 型として扱える
          const length: number = name.length;
          expect(length).toBe(2);
        } else {
          fail('isArray should return true for array');
        }
      });
    });
  });

  describe('統合テスト: formatAuthorName と Type Guard の組み合わせ', () => {
    it('Type Guard で型を絞り込んでから formatAuthorName を使用できること', () => {
      const name: string | string[] | null = ['CLAMP先生', '新條まゆ先生'];

      if (isString(name)) {
        expect(formatAuthorName(name)).toBe(name);
      } else if (isArray(name)) {
        expect(formatAuthorName(name)).toBe('CLAMP先生 / 新條まゆ先生');
      } else {
        expect(formatAuthorName(name)).toBe('');
      }
    });

    it('hasMultipleAuthors と getAuthorNamesAsArray を組み合わせて使用できること', () => {
      const name1: string | string[] | null = '尾田栄一郎先生';
      const name2: string | string[] | null = ['CLAMP先生', '新條まゆ先生'];

      expect(hasMultipleAuthors(name1)).toBe(false);
      expect(getAuthorNamesAsArray(name1)).toEqual(['尾田栄一郎先生']);

      expect(hasMultipleAuthors(name2)).toBe(true);
      expect(getAuthorNamesAsArray(name2)).toEqual(['CLAMP先生', '新條まゆ先生']);
    });
  });

  describe('エッジケース', () => {
    describe('特殊文字を含む原作者名', () => {
      it('スペースを含む名前を正しく処理すること', () => {
        expect(formatAuthorName('David A. Smith先生')).toBe('David A. Smith先生');
      });

      it('記号を含む名前を正しく処理すること', () => {
        expect(formatAuthorName('Dr.スランプ先生')).toBe('Dr.スランプ先生');
      });

      it('複数原作者で特殊文字を含む場合も正しく結合すること', () => {
        const result = formatAuthorName(['Dr.A先生', 'Prof.B先生']);
        expect(result).toBe('Dr.A先生 / Prof.B先生');
      });
    });

    describe('非常に長い原作者名', () => {
      it('長い名前でも正しく処理すること', () => {
        const longName = 'とても長い原作者名を持つ先生'.repeat(10);
        expect(formatAuthorName(longName)).toBe(longName);
      });

      it('複数の長い名前でも正しく結合すること', () => {
        const name1 = 'とても長い原作者名A'.repeat(5);
        const name2 = 'とても長い原作者名B'.repeat(5);
        const result = formatAuthorName([name1, name2]);
        expect(result).toBe(`${name1} / ${name2}`);
      });
    });

    describe('Unicode文字を含む原作者名', () => {
      it('絵文字を含む名前を正しく処理すること', () => {
        expect(formatAuthorName('🎨アート先生')).toBe('🎨アート先生');
      });

      it('各国語を含む名前を正しく処理すること', () => {
        const result = formatAuthorName(['山田太郎先生', 'John Smith', '李明']);
        expect(result).toBe('山田太郎先生 / John Smith / 李明');
      });
    });
  });
});
