import { describe, expect, it } from '@jest/globals';

import { deriveStoreContext } from '@/lib/utils/store-derivation';
import type { EventDataOccurrence } from '@revolution/schemas/mdx-frontmatter';

/** 1 開催の最小形。会場名だけ変えれば足りるケースが多い。 */
function occ(venueLabel: string, over: Partial<EventDataOccurrence> = {}): EventDataOccurrence {
  return {
    venue_slug: null,
    venue_label: venueLabel,
    starts_on: '2026-07-03',
    ends_on: '2026-09-13',
    official_url: null,
    ...over,
  };
}

/**
 * `brand-slugs.yaml` の実エントリの抜粋。
 *
 * ★ 捏造しない。すべて実ファイルに存在する組み合わせ
 *   (`BALLER:S` は S1-d Phase 3-0 で追補した分)。
 */
const BRANDS: Record<string, string> = {
  'OH MY CAFE': 'oh-my-cafe',
  'BOX cafe&space': 'box-cafe-and-space',
  'BALLER:S': 'ballers',
  'CAFE EPIC TALE': 'cafe-epic-tales',
  キャラウムカフェ: 'charaum-cafe',
  'アニメイトカフェ': 'animate-cafe',
};

describe('deriveStoreContext — 代表会場名の決定表', () => {
  // ── Step 2 ───────────────────────────────────────────────
  describe('Step 2: 会場が 1 つ', () => {
    it('支店名まで含めた venue_label をそのまま代表にする', () => {
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space マツモトキヨシ池袋Part2店')],
        brandSlugs: BRANDS,
        workTitle: '薬屋のひとりごと',
      });

      expect(r.見出し形式).toBe('venue');
      // ブランド名だけに丸めない。1 会場なら支店名まで出したほうが親切。
      expect(r.代表店舗名).toBe('BOX cafe&space マツモトキヨシ池袋Part2店');
      expect(r.見出し主語).toBe('薬屋のひとりごと × BOX cafe&space マツモトキヨシ池袋Part2店');
      expect(r.is_multi_venue).toBe(false);
    });
  });

  // ── Step 3 ───────────────────────────────────────────────
  describe('Step 3: ブランドが 1 つ', () => {
    it('複数会場でも同一ブランドならブランド名に丸める', () => {
      const r = deriveStoreContext({
        occurrences: [
          occ('BOX cafe&space グランドスケープ池袋店'),
          occ('BOX cafe&space グローバルゲート名古屋2号店'),
          occ('BOX cafe&space 天王寺MIO店'),
        ],
        brandSlugs: BRANDS,
        workTitle: '初音ミク',
      });

      expect(r.代表店舗名).toBe('BOX cafe&space');
      expect(r.見出し主語).toBe('初音ミク × BOX cafe&space');
      expect(r.会場数).toBe(3);
      expect(r.is_multi_venue).toBe(true);
    });

    it('同一会場が前期/後期で 2 回出ても 1 会場と数える', () => {
      const r = deriveStoreContext({
        occurrences: [
          occ('BOX cafe&space グランドスケープ池袋店', { starts_on: '2025-04-04', ends_on: '2025-06-02' }),
          occ('BOX cafe&space グランドスケープ池袋店', { starts_on: '2025-06-05', ends_on: '2025-07-27' }),
        ],
        brandSlugs: BRANDS,
        workTitle: '名探偵コナン',
      });

      expect(r.会場数).toBe(1);
      // 会場が 1 つなので Step 2 に落ちる（支店名まで出る）
      expect(r.代表店舗名).toBe('BOX cafe&space グランドスケープ池袋店');
    });
  });

  // ── Step 4 ───────────────────────────────────────────────
  describe('Step 4: ブランドが複数 → 公式ドメインで選ぶ', () => {
    it('★ 最多ブランドではなく、ドメインが示すブランドを代表にする', () => {
      // 実データ: 5 会場のうち BOX cafe&space が 3 で最多だが、
      // ドメインは OH MY CAFE を名乗り、実際 OH MY CAFE として開催する（BOSS 確定）。
      const r = deriveStoreContext({
        occurrences: [
          occ('OH MY CAFE 表参道ヒルズ'),
          occ('BOX cafe&space ルミネエスト新宿2号店'),
          occ('BOX cafe&space グローバルゲート名古屋2号店'),
          occ('BOX cafe&space ＫＩＴＴＥ OSAKA 2号店'),
          occ('BALLER:S イオンモール新利府店'),
        ],
        officialUrl: 'https://toy5-ohmycafe.ltr-online.com',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '愛知県', '大阪府', '宮城県'],
        eventTypeLabel: 'カフェ',
        workTitle: 'トイ・ストーリー5',
      });

      expect(r.見出し形式).toBe('venue');
      expect(r.代表店舗名).toBe('OH MY CAFE');
      expect(r.見出し主語).toBe('トイ・ストーリー5 × OH MY CAFE');
      // 他ブランドが見出しに混入しない
      expect(r.見出し主語).not.toContain('BOX cafe&space');
      expect(r.見出し主語).not.toContain('BALLER:S');
      // 連結は起きない
      expect(r.見出し主語).not.toContain('、');
    });

    it('ハイフンの有無が違っても照合できる (slug は oh-my-cafe / ドメインは ohmycafe)', () => {
      const r = deriveStoreContext({
        occurrences: [occ('OH MY CAFE 表参道ヒルズ'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://example-ohmycafe.ltr-online.com',
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(r.代表店舗名).toBe('OH MY CAFE');
    });

    it('★ ドメインが示すブランドが会場集合に無ければ採用しない', () => {
      // D.Gray-man の公式サイトは medicos-e.net（メディコス = 企業）。
      // 会場は キャラウムカフェ / CAFE EPIC TALE の 2 ブランドで、企業名は含まれない。
      // 制約が無いと「MEDICOS」が見出しに出る（store-name-validator は法人格の
      // 有無で判定するため MEDICOS 単体を弾けない）。
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ（池袋 マルビル4階）'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://www.medicos-e.net/newsdetail/d-gray-man/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: 'D.Gray-man',
      });

      expect(r.見出し形式).toBe('cities');
      expect(r.代表店舗名).toBe('');
      expect(r.見出し主語).not.toContain('MEDICOS');
      expect(r.見出し主語).not.toContain('medicos');
      expect(r.warnings.some((w) => w.includes('ドメインがどれとも一致'))).toBe(true);
    });
  });

  // ── Step 5 ───────────────────────────────────────────────
  describe('Step 5: 都市名の見出しへ', () => {
    it('{作品名} {種別} in {都道府県・都道府県} を組み立てる', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ（池袋 マルビル4階）'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://www.medicos-e.net/newsdetail/d-gray-man/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: 'D.Gray-man',
      });

      // 本番タイトル `D.Gray-man カフェ in 東京/大阪` の本文版（区切りのみ「・」）
      expect(r.見出し主語).toBe('D.Gray-man カフェ in 東京・大阪');
      expect(r.都市表記).toBe('東京・大阪');
    });

    it('都道府県が 5 件以上なら「N都市」に丸める', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '宮城県', '愛知県', '大阪府', '福岡県', '北海道'],
        eventTypeLabel: 'カフェ',
        workTitle: '名探偵コナン',
      });

      expect(r.都市表記).toBe('6都市');
      expect(r.見出し主語).toBe('名探偵コナン カフェ in 6都市');
    });

    it('4 件までは列挙する (閾値の境界)', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '宮城県', '愛知県', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      expect(r.都市表記).toBe('東京・宮城・愛知・大阪');
    });

    it('「北海道」から「道」を落とさない', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 札幌'), occ('CAFE EPIC TALE 函館')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['北海道'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      expect(r.都市表記).toBe('北海道');
    });

    it('★ 種別をハードコードしない (pop-up-store で「カフェ」と書かない)', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'ポップアップストア',
        workTitle: 'テスト作品',
      });

      expect(r.見出し主語).toBe('テスト作品 ポップアップストア in 東京・大阪');
      expect(r.見出し主語).not.toContain('カフェ');
    });
  });

  // ── 安全側への退避 ─────────────────────────────────────────
  describe('壊れた入力でも throw しない (observability 規約)', () => {
    it('辞書に無いブランドが混ざってもブランド数を誤らない', () => {
      // 未知ブランドを「1 ブランド」に数えて Step 3 に落ちると、
      // 存在しないブランドを代表として出してしまう。
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space 東京ソラマチ店'), occ('未登録ブランド 渋谷店')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      // 「BOX cafe&space」だけを代表に据えない（未登録会場を切り捨てたことになる）
      expect(r.代表店舗名).not.toBe('BOX cafe&space');
      expect(r.warnings.some((w) => w.includes('ブランド辞書に一致しない'))).toBe(true);
    });

    it('venue_label が会場名でない (都道府県が入っている) 場合も落ちない', () => {
      // Phase 2 以前のデータに実在する形。
      const r = deriveStoreContext({
        occurrences: [occ('東京・愛知・大阪')],
        brandSlugs: BRANDS,
        workTitle: '呪術廻戦',
      });

      expect(r.warnings.length).toBeGreaterThan(0);
      expect(() => r.見出し主語).not.toThrow();
    });

    it('都道府県も種別も取れなければ作品名だけに退避する', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(r.見出し主語).toBe('テスト作品');
      expect(r.warnings.some((w) => w.includes('作品名のみに退避'))).toBe(true);
    });

    it('officialUrl が URL として壊れていても throw しない', () => {
      const r = deriveStoreContext({
        occurrences: [occ('OH MY CAFE 表参道ヒルズ'), occ('CAFE EPIC TALE')],
        officialUrl: 'not-a-url',
        brandSlugs: BRANDS,
        prefectures: ['東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      expect(r.見出し形式).toBe('cities');
      expect(r.都市表記).toBe('東京');
    });

    it('occurrences が空でも既定値を返す', () => {
      const r = deriveStoreContext({ brandSlugs: BRANDS, workTitle: 'テスト作品' });

      expect(r.会場数).toBe(0);
      expect(r.is_multi_venue).toBe(false);
      expect(r.会場一覧表記).toBe('');
    });

    it('入力の occurrences を変更しない (純粋性)', () => {
      const input = [occ('OH MY CAFE 表参道ヒルズ'), occ('BOX cafe&space 東京ソラマチ店')];
      const snapshot = JSON.stringify(input);

      deriveStoreContext({
        occurrences: input,
        officialUrl: 'https://toy5-ohmycafe.ltr-online.com',
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(JSON.stringify(input)).toBe(snapshot);
    });
  });

  // ── 連結の回帰ガード ───────────────────────────────────────
  describe('連結の回帰ガード', () => {
    it('どの経路でも見出し主語に「、」区切りの会場連結が入らない', () => {
      const cases = [
        { occurrences: [occ('BOX cafe&space マツモトキヨシ池袋Part2店')], officialUrl: undefined },
        {
          occurrences: [occ('BOX cafe&space 東京ソラマチ店'), occ('BOX cafe&space 天王寺MIO店')],
          officialUrl: undefined,
        },
        {
          occurrences: [occ('OH MY CAFE 表参道ヒルズ'), occ('BALLER:S イオンモール新利府店')],
          officialUrl: 'https://toy5-ohmycafe.ltr-online.com',
        },
        {
          occurrences: [occ('キャラウムカフェ（池袋 マルビル4階）'), occ('CAFE EPIC TALE')],
          officialUrl: 'https://www.medicos-e.net/newsdetail/d-gray-man/',
        },
      ];

      for (const c of cases) {
        const r = deriveStoreContext({
          ...c,
          brandSlugs: BRANDS,
          prefectures: ['東京都', '大阪府'],
          eventTypeLabel: 'カフェ',
          workTitle: 'テスト作品',
        });
        expect(r.見出し主語).not.toContain('、');
      }
    });
  });
});
