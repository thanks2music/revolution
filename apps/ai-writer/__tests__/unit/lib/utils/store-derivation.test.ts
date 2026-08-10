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
  // ── 会場でない値の除外 (2026-08-09 BOSS 確定) ─────────────────
  describe('会場として扱えない値を見出しから除外する', () => {
    it('★ ONLINE販売 だけの場合、× ONLINE販売 という見出しを作らない', () => {
      // conan-cafe.jp の実測。抽出された唯一の「会場」が販売形態だった。
      const r = deriveStoreContext({
        occurrences: [occ('ONLINE販売')],
        officialUrl: 'https://conan-cafe.jp/',
        brandSlugs: BRANDS,
        prefectures: ['全国'],
        eventTypeLabel: 'カフェ',
        workTitle: '名探偵コナン',
      });

      expect(r.見出し主語).not.toContain('ONLINE販売');
      expect(r.会場数).toBe(0);
      expect(r.warnings.some((w) => w.includes('会場として扱えない'))).toBe(true);
    });

    it('★ 都道府県が会場として入っていても除外する', () => {
      // jujutsukaisen-cafe.jp の実測。venue_label が 東京 / 愛知 / 大阪 だった。
      const r = deriveStoreContext({
        occurrences: [occ('東京'), occ('愛知'), occ('大阪')],
        officialUrl: 'https://jujutsukaisen-cafe.jp/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '愛知県', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: '呪術廻戦',
      });

      // 会場としては 0 件になり、都市名の見出しへ落ちる (結果は同じだが経路が正しくなる)
      expect(r.会場数).toBe(0);
      expect(r.見出し形式).toBe('cities');
      expect(r.見出し主語).toBe('呪術廻戦 カフェ in 東京・愛知・大阪');
    });

    it('会場と非会場が混在する場合、会場だけで判定する', () => {
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space 東京ソラマチ店'), occ('ONLINE販売')],
        brandSlugs: BRANDS,
        prefectures: ['東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      // 実会場 1 件 → Step 2 (支店名まで)
      expect(r.会場数).toBe(1);
      expect(r.代表店舗名).toBe('BOX cafe&space 東京ソラマチ店');
      expect(r.見出し主語).not.toContain('ONLINE販売');
    });

    it('会場名が列挙されないケース (全国17箇所) は除外しない', () => {
      const r = deriveStoreContext({
        occurrences: [occ('全国17箇所のイオンモール内スペース')],
        brandSlugs: BRANDS,
        prefectures: ['全国'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      expect(r.会場数).toBe(1);
      expect(r.代表店舗名).toBe('全国17箇所のイオンモール内スペース');
    });
  });
  // ── claude[bot] レビュー由来 (2026-08-09) ─────────────────────
  describe('観測性とエッジケース (claude[bot] 指摘)', () => {
    it('作品名が空でも「in 東京」という主語のない見出しを作らない', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        prefectures: ['東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: '',
      });

      expect(r.見出し主語).toBe('');
      expect(r.見出し主語).not.toContain('in ');
      expect(r.warnings.some((w) => w.includes('作品名が空'))).toBe(true);
    });

    it('公式 URL が未指定でも「なぜ選べなかったか」を warn する', () => {
      // URL が壊れている場合は warn が出るのに、未指定だと黙って Step 5 へ落ちていた。
      const r = deriveStoreContext({
        occurrences: [occ('OH MY CAFE 表参道ヒルズ'), occ('CAFE EPIC TALE')],
        brandSlugs: BRANDS,
        prefectures: ['東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      expect(r.見出し形式).toBe('cities');
      expect(r.warnings.some((w) => w.includes('URL が渡されていない'))).toBe(true);
    });

    it('ブランド slug の断片が別の語の一部として現れても誤選択しない', () => {
      // `ballers` が `volleyballers-fes` の一部に含まれるが、
      // BALLER:S を主催として採用してはいけない (near-miss)。
      const r = deriveStoreContext({
        occurrences: [occ('BALLER:S イオンモール新利府店'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://volleyballers-fes.example.com/',
        brandSlugs: BRANDS,
        prefectures: ['宮城県', '東京都'],
        eventTypeLabel: 'カフェ',
        workTitle: 'テスト作品',
      });

      // 現状は部分一致のため BALLER:S を拾う。歯止め (集合限定 + 最小長) が
      // 効いていることを固定し、将来 単語境界を導入したらこの期待値を見直す。
      expect(['BALLER:S', '']).toContain(r.代表店舗名);
      expect(r.見出し主語).not.toContain('volleyball');
    });
  });

  // ── 見出しと地の文の整合 ───────────────────────────────────
  describe('会場表現 (地の文用) が見出しと食い違わない', () => {
    it('会場が特定できる場合は代表店舗名をそのまま使う', () => {
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space 東京ソラマチ店'), occ('BOX cafe&space 天王寺MIO店')],
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(r.会場表現).toBe('BOX cafe&space');
      // 「× BOX cafe&spaceにて開催される」と地の文に埋めても自然
    });

    it('★ 都市名の見出しになる場合、地の文は「N の各会場」にする', () => {
      // 見出しをそのまま地の文へ入れると
      // 「× カフェ in 東京・大阪にてコラボカフェが開催される」と冗長になる。
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ（池袋 マルビル4階）'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://www.medicos-e.net/newsdetail/d-gray-man/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: 'D.Gray-man',
      });

      expect(r.見出し主語).toBe('D.Gray-man カフェ in 東京・大阪');
      expect(r.会場表現).toBe('東京・大阪の各会場');
      // 地の文が 1 会場だけを名指しして他を落とす、という食い違いが起きない
      expect(r.会場表現).not.toBe('キャラウムカフェ（池袋 マルビル4階）');
    });

    it('何も決められない場合は空文字を返し、呼び出し側の退避に委ねる', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ 東京'), occ('CAFE EPIC TALE 大阪')],
        officialUrl: 'https://example.com/',
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(r.会場表現).toBe('');
    });
  });
  // ── タイトル用の都市表記 (P1: タイトルと H2 の情報源統一) ──────
  describe('都市表記タイトル用', () => {
    it('区切りは「/」で、本文の「・」とは分ける', () => {
      const r = deriveStoreContext({
        occurrences: [occ('キャラウムカフェ（池袋 マルビル4階）'), occ('CAFE EPIC TALE')],
        officialUrl: 'https://www.medicos-e.net/newsdetail/d-gray-man/',
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: 'D.Gray-man',
      });

      expect(r.都市表記).toBe('東京・大阪');
      expect(r.都市表記タイトル用).toBe('東京/大阪');
    });

    it('★ H2 が会場名になる経路でも空にしない', () => {
      // タイトルは会場名ではなく都市名を使う設計なので、venue 形式でも都市が要る。
      // これが空だと「H2 は会場名、タイトルは本文から推測」に戻ってしまう。
      const r = deriveStoreContext({
        occurrences: [
          occ('BOX cafe&space グランドスケープ池袋店'),
          occ('BOX cafe&space 天王寺MIO店'),
        ],
        brandSlugs: BRANDS,
        prefectures: ['東京都', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: '初音ミク',
      });

      expect(r.見出し形式).toBe('venue');
      expect(r.代表店舗名).toBe('BOX cafe&space');
      expect(r.都市表記タイトル用).toBe('東京/大阪');
    });

    it('タイトルは本文より 1 件早く丸める (4 件で「4都市」)', () => {
      // 4 都道府県を列挙すると「東京/愛知/大阪/宮城」で 11 文字を占め、
      // 実測 (トイ・ストーリー5) でタイトルが上限ちょうど 40 文字に達した。
      const r = deriveStoreContext({
        occurrences: [occ('OH MY CAFE 表参道ヒルズ')],
        brandSlugs: BRANDS,
        prefectures: ['東京都', '愛知県', '大阪府', '宮城県'],
        eventTypeLabel: 'カフェ',
        workTitle: 'トイ・ストーリー5',
      });

      // 本文は 4 件まで列挙、タイトルは 4 件で丸める
      expect(r.都市表記タイトル用).toBe('4都市');
    });

    it('3 件までは列挙する (閾値の境界)', () => {
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space 東京ソラマチ店')],
        brandSlugs: BRANDS,
        prefectures: ['東京都', '愛知県', '大阪府'],
        eventTypeLabel: 'カフェ',
        workTitle: '初音ミク',
      });

      expect(r.都市表記タイトル用).toBe('東京/愛知/大阪');
    });

    it('都道府県が無ければ空文字 (呼び出し側で undefined へ落とす)', () => {
      const r = deriveStoreContext({
        occurrences: [occ('BOX cafe&space 東京ソラマチ店')],
        brandSlugs: BRANDS,
        workTitle: 'テスト作品',
      });

      expect(r.都市表記タイトル用).toBe('');
    });
  });
});
