import { describe, expect, it } from '@jest/globals';

import { deriveStoreContext } from '@/lib/utils/store-derivation';
import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

function occ(over: Partial<EventDataOccurrence> = {}): EventDataOccurrence {
  return {
    venue_slug: null,
    venue_label: 'テスト会場',
    starts_on: '2026-07-03',
    ends_on: '2026-09-13',
    official_url: null,
    ...over,
  };
}

describe('deriveStoreContext', () => {
  describe('単一会場 (後方互換)', () => {
    it('代表店舗名は store.name をそのまま使う', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'BOX cafe&space マツモトキヨシ池袋Part2店' })],
        storeName: 'BOX cafe&space マツモトキヨシ池袋Part2店',
      });

      expect(ctx.代表店舗名).toBe('BOX cafe&space マツモトキヨシ池袋Part2店');
      expect(ctx.会場数).toBe(1);
      expect(ctx.is_multi_venue).toBe(false);
    });

    it('会場一覧表記は 1 会場ならその名前だけ', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'A店' })],
        storeName: 'A店',
      });

      expect(ctx.会場一覧表記).toBe('A店');
    });
  });

  describe('複数会場', () => {
    it('会場数と一覧を導出する', () => {
      const ctx = deriveStoreContext({
        occurrences: [
          occ({ venue_label: 'A店' }),
          occ({ venue_label: 'B店' }),
          occ({ venue_label: 'C店' }),
        ],
        storeName: 'ブランド名',
      });

      expect(ctx.会場数).toBe(3);
      expect(ctx.is_multi_venue).toBe(true);
      expect(ctx.会場一覧).toEqual(['A店', 'B店', 'C店']);
      expect(ctx.会場一覧表記).toBe('A店、B店、C店');
    });

    // ★ 代表店舗名に連結文字列が入ってはならない。
    //   本文の H2 見出しに全会場が並ぶ実測バグの直接の原因になる。
    it('代表店舗名に「、」区切りの連結が含まれない', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'A店' }), occ({ venue_label: 'B店' })],
        storeName: 'ブランド名',
      });

      expect(ctx.代表店舗名).not.toContain('、');
    });

    // ★ 実データ (PR TIMES 000000209/000000216): 8 会場すべてが前期/後期に分かれ
    //   occurrences は 16 要素になる。これを「16 会場」と数えると本文が事実誤認になる。
    it('同一会場の前期/後期を 1 会場として数える', () => {
      const ctx = deriveStoreContext({
        occurrences: [
          occ({ venue_label: '池袋店', starts_on: '2025-04-04', ends_on: '2025-06-02' }),
          occ({ venue_label: '池袋店', starts_on: '2025-06-05', ends_on: '2025-07-27' }),
          occ({ venue_label: '渋谷店', starts_on: '2025-04-18', ends_on: '2025-05-19' }),
          occ({ venue_label: '渋谷店', starts_on: '2025-05-22', ends_on: '2025-06-29' }),
        ],
        storeName: 'BOX cafe&space',
      });

      expect(ctx.会場数).toBe(2);
      expect(ctx.会場一覧).toEqual(['池袋店', '渋谷店']);
    });

    it('会場一覧は出現順を保つ', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'C店' }), occ({ venue_label: 'A店' }), occ({ venue_label: 'B店' })],
      });

      expect(ctx.会場一覧).toEqual(['C店', 'A店', 'B店']);
    });
  });

  describe('フォールバックと異常系', () => {
    it('store.name が欠落したら先頭会場を代表にする', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'A店' }), occ({ venue_label: 'B店' })],
      });

      expect(ctx.代表店舗名).toBe('A店');
    });

    it('store.name が空白のみでも先頭会場へフォールバックする', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: 'A店' })],
        storeName: '   ',
      });

      expect(ctx.代表店舗名).toBe('A店');
    });

    it('venue_label が null の要素は会場として数えない', () => {
      const ctx = deriveStoreContext({
        occurrences: [occ({ venue_label: null }), occ({ venue_label: 'A店' })],
      });

      expect(ctx.会場数).toBe(1);
      expect(ctx.会場一覧).toEqual(['A店']);
    });

    it('occurrences が空 / undefined でも落ちない', () => {
      expect(deriveStoreContext({}).会場数).toBe(0);
      expect(deriveStoreContext({ occurrences: [] }).is_multi_venue).toBe(false);
      expect(deriveStoreContext({ occurrences: null }).会場一覧表記).toBe('');
    });

    it('会場も store.name も無ければ代表店舗名は空文字', () => {
      expect(deriveStoreContext({}).代表店舗名).toBe('');
    });
  });
});
