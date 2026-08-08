import { describe, expect, it } from '@jest/globals';

import { normalizeOccurrences } from '@/lib/utils/occurrence-normalizer';
import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

/** 1 開催の最小形。テストごとに必要な項目だけ上書きする。 */
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

describe('normalizeOccurrences', () => {
  describe('恒等性 (既に正しい入力を壊さない)', () => {
    it('N 件の入力を N 件のまま返す', () => {
      const input = [
        occ({ venue_label: 'A店' }),
        occ({ venue_label: 'B店' }),
        occ({ venue_label: 'C店' }),
      ];
      const { occurrences, warnings } = normalizeOccurrences({ occurrences: input });

      expect(occurrences).toHaveLength(3);
      expect(occurrences.map((o) => o.venue_label)).toEqual(['A店', 'B店', 'C店']);
      expect(warnings).toHaveLength(0);
    });

    it('入力配列を破壊しない (純粋関数)', () => {
      const input = [occ({ venue_label: 'A店、B店' })];
      const snapshot = JSON.parse(JSON.stringify(input));

      normalizeOccurrences({ occurrences: input });

      expect(input).toEqual(snapshot);
    });

    it('空配列 / undefined / null を安全に通す', () => {
      expect(normalizeOccurrences({ occurrences: [] }).occurrences).toEqual([]);
      expect(normalizeOccurrences({}).occurrences).toEqual([]);
      expect(normalizeOccurrences({ occurrences: null }).occurrences).toEqual([]);
    });
  });

  describe('連結された会場名の分割 (2026-08-07 実測バグの回帰ガード)', () => {
    // 5 会場のイベントで occurrences が 1 件、venue_label が
    // 「OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店、…」に
    // なっていた実測バグ。プロンプトを直した後の回帰も、ここで捕まえる。
    it('「、」区切りの連結を会場数だけの要素に分割する', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'OH MY CAFE 表参道ヒルズ、BOX cafe&space ルミネエスト新宿2号店、BALLER:S イオンモール新利府店' })],
      });

      expect(occurrences).toHaveLength(3);
      expect(occurrences.map((o) => o.venue_label)).toEqual([
        'OH MY CAFE 表参道ヒルズ',
        'BOX cafe&space ルミネエスト新宿2号店',
        'BALLER:S イオンモール新利府店',
      ]);
      expect(warnings.some((w) => w.includes('分割'))).toBe(true);
    });

    it('分割後の各要素が元の日付を引き継ぐ', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'A店、B店', starts_on: '2026-07-03', ends_on: '2026-09-13' })],
      });

      expect(occurrences.every((o) => o.starts_on === '2026-07-03')).toBe(true);
      expect(occurrences.every((o) => o.ends_on === '2026-09-13')).toBe(true);
    });

    // ★「・」は分割してはならない。実データ (PR TIMES 000000269) の
    //   「BOX cafe&space ルミネエスト新宿 1号店・2号店」は 1 行 1 住所で、
    //   原文が 1 会場として扱っている。分割すると原文にない会場を作り出す。
    it('「・」では分割しない (1号店・2号店は 1 会場のまま)', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'BOX cafe&space ルミネエスト新宿 1号店・2号店' })],
      });

      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]?.venue_label).toBe('BOX cafe&space ルミネエスト新宿 1号店・2号店');
      expect(warnings.some((w) => w.includes('分割'))).toBe(false);
    });

    // ★ 会場名が個別列挙されないケース (PR TIMES 000000212)。
    //   「全国17箇所のイオンモール内スペース」は店名も住所も原文にないため、
    //   17 要素に増やす (= 捏造) のではなく 1 要素のまま保存する。
    it('会場名が個別列挙されないケースは 1 要素のまま保つ', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ venue_label: '全国17箇所のイオンモール内スペース' })],
      });

      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]?.venue_label).toBe('全国17箇所のイオンモール内スペース');
    });
  });

  describe('空白の正規化', () => {
    it('全角空白 (U+3000) を含む前後の空白を trim する', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ venue_label: '　 A店 　' })],
      });

      expect(occurrences[0]?.venue_label).toBe('A店');
    });

    it('分割後に空になる要素を落とす', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'A店、　、B店' })],
      });

      expect(occurrences.map((o) => o.venue_label)).toEqual(['A店', 'B店']);
    });

    it('空白のみの venue_label は null にする (schema の min(1) 違反を防ぐ)', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ venue_label: '　　' })],
      });

      expect(occurrences[0]?.venue_label).toBeNull();
    });
  });

  describe('年跨ぎ補正 (実データ: 終了年の省略)', () => {
    // 「2025年12月20日（土）～2月8日（日）」のように終了側の年が書かれない表記が
    // 冬シーズンに集中する。素直にパースすると end < start で逆転する。
    it('ends_on < starts_on なら終了年を +1 して補正する', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ starts_on: '2025-12-20', ends_on: '2025-02-08' })],
      });

      expect(occurrences[0]?.ends_on).toBe('2026-02-08');
      expect(warnings.some((w) => w.includes('年跨ぎ'))).toBe(true);
    });

    it('正常な期間は補正しない', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ starts_on: '2026-07-03', ends_on: '2026-09-13' })],
      });

      expect(occurrences[0]?.ends_on).toBe('2026-09-13');
      expect(warnings.some((w) => w.includes('年跨ぎ'))).toBe(false);
    });

    it('+1 年でも解消しない逆転は補正せず warn に留める (データ異常)', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ starts_on: '2026-12-20', ends_on: '2020-02-08' })],
      });

      expect(occurrences[0]?.ends_on).toBe('2020-02-08');
      expect(warnings.some((w) => w.includes('解消しませんでした'))).toBe(true);
    });
  });

  describe('日付の補完と欠落の扱い', () => {
    it('starts_on 欠落時は fallbackPeriod から補完する', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ starts_on: null, ends_on: null })],
        fallbackPeriod: { startsOn: '2026-07-03', endsOn: '2026-09-13' },
      });

      expect(occurrences[0]?.starts_on).toBe('2026-07-03');
      expect(occurrences[0]?.ends_on).toBe('2026-09-13');
    });

    // ★ 捏造させない。必須にしていたために実測で
    //   `2025-01-01 〜 2025-12-31` の 1 年間まるごとの捏造が出ていた。
    it('補完できない場合は null のまま通す (捏造しない)', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ starts_on: null, ends_on: null })],
      });

      expect(occurrences[0]?.starts_on).toBeNull();
      expect(occurrences[0]?.ends_on).toBeNull();
      expect(warnings.some((w) => w.includes('starts_on が未確定'))).toBe(true);
    });

    it('空文字の日付は null 扱いにする', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [occ({ starts_on: '', ends_on: '  ' } as Partial<EventDataOccurrence>)],
      });

      expect(occurrences[0]?.starts_on).toBeNull();
      expect(occurrences[0]?.ends_on).toBeNull();
    });
  });

  describe('重複の除去', () => {
    it('会場名も期間も同じ要素は 1 件に畳む', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'A店' }), occ({ venue_label: 'A店' })],
      });

      expect(occurrences).toHaveLength(1);
      expect(warnings.some((w) => w.includes('重複'))).toBe(true);
    });

    // ★ 前期/後期を潰してはならない。実データ (PR TIMES 000000209/000000216) では
    //   8 会場すべてが前期・後期に分かれ、計 16 開催になる。
    it('同一会場でも期間が違えば別開催として残す (前期/後期)', () => {
      const { occurrences } = normalizeOccurrences({
        occurrences: [
          occ({ venue_label: 'BOX cafe&space グランドスケープ池袋店', starts_on: '2025-04-04', ends_on: '2025-06-02' }),
          occ({ venue_label: 'BOX cafe&space グランドスケープ池袋店', starts_on: '2025-06-05', ends_on: '2025-07-27' }),
        ],
      });

      expect(occurrences).toHaveLength(2);
      expect(occurrences[0]?.venue_label).toBe(occurrences[1]?.venue_label);
      expect(occurrences[0]?.starts_on).not.toBe(occurrences[1]?.starts_on);
    });
  });

  describe('会場数の cross-check (warn のみ、throw しない)', () => {
    it('都道府県数より occurrences が少ないと warn する', () => {
      const { occurrences, warnings } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'A店' })],
        prefectures: ['東京都', '大阪府', '愛知県'],
      });

      expect(occurrences).toHaveLength(1); // 落とさない
      expect(warnings.some((w) => w.includes('取りこぼし'))).toBe(true);
    });

    it('件数が揃っていれば warn しない', () => {
      const { warnings } = normalizeOccurrences({
        occurrences: [occ({ venue_label: 'A店' }), occ({ venue_label: 'B店' })],
        prefectures: ['東京都', '大阪府'],
      });

      expect(warnings.some((w) => w.includes('取りこぼし'))).toBe(false);
    });

    it('不整合があっても throw しない (observability 規約)', () => {
      expect(() =>
        normalizeOccurrences({
          occurrences: [occ({ starts_on: null })],
          prefectures: ['東京都', '大阪府', '愛知県'],
        }),
      ).not.toThrow();
    });
  });
});
