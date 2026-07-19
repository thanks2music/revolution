/**
 * Layer 1 tests for LeadGeneratorService (Sprint C-β P11).
 *
 * Focus (Plan `docs/plan/sprint-c/2026-07-19-*-phase-2d-*.md` §4 参照):
 * - Condition predicate table: 20+ 条件分岐 (単一 15 + 複数コラボ 3 + fallback 2 + オリジナルアニメ 5)
 * - 4 スロット構造 (agent/verb/adjective/mediaForm/workTitle) の regression assertion
 * - N9-A regression: character/vocaloid 単一作品で「らをイメージした」テンプレ維持
 * - P5 regression: 原作タイプ novel_based → 「ライトノベル」表現 (「漫画」誤生成しない)
 * - Fallback 経路 (LLM 未 DI 時に lead_generic 強制採用、fallbackReason 記録)
 */

import * as path from 'path';

import { LEAD_FALLBACK_TEMPLATE_ID } from '@revolution/schemas/lead-response';

import {
  LeadGeneratorService,
  resetLeadGeneratorService,
  __INTERNAL_CONDITION_PREDICATES__,
  __INTERNAL_SLOT_DEFINITIONS__,
  type LeadGeneratorInput,
} from '../../../../lib/services/lead-generator.service';
import {
  MediaFormResolverService,
  resetMediaFormResolverService,
} from '../../../../lib/services/media-form-resolver.service';
import {
  MediaTypeMapperService,
  resetMediaTypeMapperService,
} from '../../../../lib/services/media-type-mapper.service';
import { TextPlaceholderReplacerService } from '../../../../lib/services/text-placeholder-replacer.service';

const mediaTypeMappingYamlPath = path.join(
  __dirname,
  '../../../../templates/config/media-type-mapping.yaml'
);
const leadYamlPath = path.join(
  __dirname,
  '../../../../templates/collabo-cafe/sections/01-lead.yaml'
);

/**
 * Standard 開催期間 fixture (2026-05-01 〜 2026-06-30、同年、終了日確定)。
 */
const 標準開催期間 = {
  開始: { 年: '2026年', 日付: '5月1日' },
  終了: { 年: '2026年', 日付: '6月30日', 未定: false },
};

/**
 * Base input factory (works/store/開催期間 の minimum required set)。
 */
function makeInput(overrides: Partial<LeadGeneratorInput> = {}): LeadGeneratorInput {
  return {
    works: [{ title: 'テスト作品', is_primary: true }],
    store: { name: 'テストカフェ' },
    開催期間: 標準開催期間,
    ...overrides,
  };
}

// ============================================================================
// Test setup
// ============================================================================

let service: LeadGeneratorService;

beforeAll(() => {
  const mediaFormResolver = new MediaFormResolverService(mediaTypeMappingYamlPath);
  const mediaTypeMapper = new MediaTypeMapperService(mediaTypeMappingYamlPath);
  const textReplacer = new TextPlaceholderReplacerService();
  service = new LeadGeneratorService({
    mediaFormResolver,
    mediaTypeMapper,
    textReplacer,
    yamlPath: leadYamlPath,
  });
});

afterAll(() => {
  resetLeadGeneratorService();
  resetMediaFormResolverService();
  resetMediaTypeMapperService();
});

// ============================================================================
// describe 1: 単一作品 - 原作者あり (3 pattern)
// ============================================================================

describe('LeadGeneratorService - 単一作品 - 原作者あり (3 pattern)', () => {
  it('lead_author_with_theme_and_characters: 原作者 + テーマ名 + キャラクター名 で match', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'manga',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: '芥見下々先生',
        キャラクター名: ['五条悟', '虎杖悠仁'],
        テーマ名: '呪術師の日常',
        ノベルティ名: 'クリアファイル',
        グッズ名: ['アクリルスタンド', 'キーホルダー'],
        works: [{ title: '呪術廻戦', is_primary: true }],
        store: { name: 'BOX cafe&space' },
      })
    );

    expect(result.usedTemplate).toBe('lead_author_with_theme_and_characters');
    expect(result.slots.agent).toBe('芥見下々先生');
    expect(result.slots.verb).toBe('による');
    expect(result.slots.mediaForm).toBe('漫画');
    expect(result.slots.workTitle).toBe('呪術廻戦');
    expect(result.leadMdx).toContain('芥見下々先生');
    expect(result.leadMdx).toContain('呪術廻戦');
    expect(result.leadMdx).toContain('BOX cafe&space');
    expect(result.fallbackReason).toBeUndefined();
  });

  it('lead_author_with_characters: 原作者 + キャラクター名 (テーマ名なし) で match', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: '尾田栄一郎先生',
        キャラクター名: ['ルフィ', 'ゾロ', 'ナミ'],
        works: [{ title: 'ONE PIECE', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_author_with_characters');
    expect(result.slots.agent).toBe('尾田栄一郎先生');
    expect(result.slots.mediaForm).toBe('漫画'); // manga_based を原作タイプ優先
    // §6.1 準拠: 「、」区切り + 内部中黒 (該当なし) 保持
    expect(result.leadMdx).toContain('ルフィ、ゾロ、ナミ');
    expect(result.leadMdx).not.toContain('ルフィ・ゾロ・ナミ'); // 旧「・」区切り regression 防止
  });

  it('lead_author_only: 原作者のみ (キャラクター/テーマなし) で match', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'manga',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: 'CLAMP先生',
        works: [{ title: 'カードキャプターさくら', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_author_only');
    expect(result.slots.agent).toBe('CLAMP先生');
    expect(result.slots.mediaForm).toBe('漫画');
  });
});

// ============================================================================
// describe 2: 単一作品 - 原作者なし + メディアタイプ別 (10 pattern)
// ============================================================================

describe('LeadGeneratorService - 単一作品 - 原作者なし + メディアタイプ別 (10 pattern)', () => {
  it('lead_game_with_characters: 原作者なし game + キャラクター名', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'game',
        原作タイプ: 'game_original',
        原作者有無: false,
        キャラクター名: ['マリオ', 'ルイージ'],
        works: [{ title: 'スーパーマリオ', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_game_with_characters');
    expect(result.slots.mediaForm).toBe('ゲーム');
    expect(result.leadMdx).toContain('ゲーム');
    expect(result.leadMdx).toContain('マリオ、ルイージ');
  });

  it('lead_game_generic: 原作者なし game + キャラクター名なし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'game',
        原作タイプ: 'game_original',
        原作者有無: false,
        works: [{ title: 'ポケットモンスター', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_game_generic');
    expect(result.slots.mediaForm).toBe('ゲーム');
  });

  it('lead_vtuber: メディアタイプ vtuber', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'vtuber',
        原作タイプ: 'youtuber',
        原作者有無: false,
        works: [{ title: 'ホロライブ', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_vtuber');
    expect(result.slots.mediaForm).toBe('VTuber');
  });

  it('lead_youtuber: メディアタイプ youtuber', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'youtuber',
        原作タイプ: 'youtuber',
        原作者有無: false,
        works: [{ title: 'HikakinTV', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_youtuber');
    expect(result.slots.mediaForm).toBe('YouTuber');
  });

  it('lead_idol: メディアタイプ idol (§6.2 G9 verified: label = アイドル)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'idol',
        原作タイプ: 'idol',
        原作者有無: false,
        works: [{ title: '乃木坂46', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_idol');
    expect(result.slots.mediaForm).toBe('アイドル');
    // §6.2 G9 verified: 「アイドルグループ」ではなく「アイドル」
    expect(result.slots.mediaForm).not.toBe('アイドルグループ');
  });

  it('lead_voice_actor: メディアタイプ voice_actor', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'voice_actor',
        原作タイプ: 'voice_actor',
        原作者有無: false,
        works: [{ title: '花江夏樹', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_voice_actor');
    expect(result.slots.mediaForm).toBe('声優');
  });

  it('lead_movie_with_characters: メディアタイプ movie + キャラクター名', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'movie',
        原作タイプ: 'studio_production',
        原作者有無: false,
        キャラクター名: ['ウッディ', 'バズ'],
        works: [{ title: 'トイ・ストーリー', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_movie_with_characters');
    expect(result.slots.mediaForm).toBe('映画');
  });

  it('lead_movie_generic: メディアタイプ movie + キャラクター名なし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'movie',
        原作タイプ: 'studio_production',
        原作者有無: false,
        works: [{ title: 'アバター', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_movie_generic');
    expect(result.slots.mediaForm).toBe('映画');
  });

  it('lead_tokusatsu_with_characters: メディアタイプ tokusatsu + キャラクター名', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'tokusatsu',
        原作タイプ: 'tokusatsu',
        原作者有無: false,
        キャラクター名: ['仮面ライダーゼロワン'],
        works: [{ title: '仮面ライダー', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_tokusatsu_with_characters');
    expect(result.slots.mediaForm).toBe('特撮作品');
  });

  it('lead_tokusatsu_generic: メディアタイプ tokusatsu + キャラクター名なし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'tokusatsu',
        原作タイプ: 'tokusatsu',
        原作者有無: false,
        works: [{ title: 'ウルトラマン', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_tokusatsu_generic');
    expect(result.slots.mediaForm).toBe('特撮作品');
  });
});

// ============================================================================
// describe 3: オリジナルアニメ (5 pattern、スタジオ/監督/シリーズ 対応)
// ============================================================================

describe('LeadGeneratorService - オリジナルアニメ (スタジオ/監督/シリーズ、優先度順 5 pattern)', () => {
  it('lead_studio_director_series_with_characters: スタジオ + 監督 + シリーズ + キャラ', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'original_anime',
        原作者有無: false,
        スタジオ名: 'ufotable',
        監督名: '外崎春雄',
        シリーズ名: '鬼滅の刃',
        キャラクター名: ['竈門炭治郎', '禰豆子'],
        works: [{ title: '鬼滅の刃 遊郭編', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_studio_director_series_with_characters');
    expect(result.slots.mediaForm).toBe('アニメ');
    expect(result.slots.agent).toContain('ufotable');
    expect(result.slots.agent).toContain('外崎春雄');
  });

  it('lead_studio_director: スタジオ + 監督 + シリーズなし + キャラなし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'original_anime',
        原作者有無: false,
        スタジオ名: 'A-1 Pictures',
        監督名: '足立慎吾',
        works: [{ title: 'リコリス・リコイル', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_studio_director');
  });

  it('lead_studio: スタジオのみ (監督なし)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'original_anime',
        原作者有無: false,
        スタジオ名: '京都アニメーション',
        works: [{ title: 'ヴァイオレット・エヴァーガーデン', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_studio');
    expect(result.slots.agent).toBe('京都アニメーション');
  });

  it('lead_director: 監督のみ (スタジオなし)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'original_anime',
        原作者有無: false,
        監督名: '新海誠',
        works: [{ title: '天気の子', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_director');
    expect(result.slots.agent).toContain('新海誠');
  });

  it('lead_original_anime_generic: オリジナルアニメ (スタジオ/監督/シリーズ全なし)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'original_anime',
        原作者有無: false,
        works: [{ title: '謎のオリジナルアニメ', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_original_anime_generic');
    expect(result.slots.mediaForm).toBe('オリジナルアニメ');
  });
});

// ============================================================================
// describe 4: vocaloid / character (4 pattern)
// ============================================================================

describe('LeadGeneratorService - vocaloid / character (4 pattern、N9-A regression 含む)', () => {
  it('lead_vocaloid_with_characters: vocaloid + キャラクター名 (N9-A: らをイメージした 維持)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'vocaloid',
        原作タイプ: 'vocaloid_character',
        原作者有無: false,
        キャラクター名: ['初音ミク', '鏡音リン', '鏡音レン'],
        works: [{ title: '初音ミク', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_vocaloid_with_characters');
    // N9-A regression: 「らをイメージした」テンプレ維持
    expect(result.leadMdx).toContain('らをイメージした');
    // §6.1: character 区切り「、」
    expect(result.leadMdx).toContain('初音ミク、鏡音リン、鏡音レン');
    // §6.2: vocaloid_character → バーチャル・シンガー
    expect(result.slots.mediaForm).toBe('バーチャル・シンガー');
  });

  it('lead_vocaloid_generic: vocaloid + キャラクター名なし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'vocaloid',
        原作タイプ: 'vocaloid_character',
        原作者有無: false,
        works: [{ title: '初音ミク', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_vocaloid_generic');
    expect(result.slots.mediaForm).toBe('バーチャル・シンガー');
  });

  it('lead_character_with_characters: character + キャラクター名 (N9-A: らをイメージした 維持)', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'character',
        原作タイプ: 'character_brand',
        原作者有無: false,
        キャラクター名: ['ハローキティ', 'マイメロディ', 'シナモロール'],
        works: [{ title: 'サンリオキャラクターズ', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_character_with_characters');
    // N9-A regression: 「らをイメージした」テンプレ維持
    expect(result.leadMdx).toContain('らをイメージした');
    // §6.1: character 区切り「、」
    expect(result.leadMdx).toContain('ハローキティ、マイメロディ、シナモロール');
    expect(result.slots.mediaForm).toBe('キャラクター');
  });

  it('lead_character_generic: character + キャラクター名なし', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'character',
        原作タイプ: 'character_brand',
        原作者有無: false,
        works: [{ title: 'ポチャッコ', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_character_generic');
    expect(result.slots.mediaForm).toBe('キャラクター');
  });
});

// ============================================================================
// describe 5: 複数作品コラボ (3 pattern)
// ============================================================================

describe('LeadGeneratorService - 複数作品コラボ (最優先、3 pattern)', () => {
  it('lead_multi_work_anime_x_character: anime × キャラクターブランド', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: 'PEACH-PIT先生',
        works: [
          { title: 'ローゼンメイデン', is_primary: true },
          { title: 'サンリオ', is_primary: false },
        ],
      })
    );

    expect(result.usedTemplate).toBe('lead_multi_work_anime_x_character');
    expect(result.slots.workTitle).toBe('ローゼンメイデン');
  });

  it('lead_multi_work_character_x_character: character × character', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'character',
        原作タイプ: 'character_brand',
        原作者有無: false,
        works: [
          { title: 'サンリオ', is_primary: true },
          { title: 'サンエックス', is_primary: false },
        ],
      })
    );

    expect(result.usedTemplate).toBe('lead_multi_work_character_x_character');
    expect(result.slots.mediaForm).toBe('キャラクター');
  });

  it('lead_multi_work_generic: 上記以外の複数作品コラボ', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'game',
        原作タイプ: 'game_original',
        原作者有無: false,
        works: [
          { title: 'ゲームA', is_primary: true },
          { title: 'ゲームB', is_primary: false },
        ],
      })
    );

    expect(result.usedTemplate).toBe('lead_multi_work_generic');
  });
});

// ============================================================================
// describe 6: 汎用 fallback (2 pattern)
// ============================================================================

describe('LeadGeneratorService - 汎用 fallback (2 pattern)', () => {
  it('lead_generic_with_characters: 上記いずれも match しない + キャラクター名あり', async () => {
    const result = await service.generate(
      makeInput({
        // メディアタイプ / 原作タイプ / 原作者有無 全て未指定
        キャラクター名: ['謎のキャラ'],
        works: [{ title: '謎の作品', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_generic_with_characters');
    // fallback mediaForm は §6.2 最終 fallback「作品」
    expect(result.slots.mediaForm).toBe('作品');
  });

  it('lead_generic: 全 catch-all (キャラクター名すらなし)', async () => {
    const result = await service.generate(
      makeInput({
        works: [{ title: '完全に情報不足', is_primary: true }],
      })
    );

    expect(result.usedTemplate).toBe('lead_generic');
    expect(result.slots.mediaForm).toBe('作品');
  });
});

// ============================================================================
// describe 7: 4 スロット構造 regression assertion (全 template で必須)
// ============================================================================

describe('LeadGeneratorService - 4 スロット構造 regression (mediaForm + workTitle 必須)', () => {
  it('全 slots が mediaForm/workTitle を必ず埋めている (empty string 禁止)', async () => {
    // 代表的な template 5 pattern を network 的に verify
    const cases: Array<{ name: string; input: Partial<LeadGeneratorInput> }> = [
      {
        name: 'author',
        input: {
          メディアタイプ: 'manga',
          原作タイプ: 'manga_based',
          原作者有無: true,
          原作者名: 'X先生',
          works: [{ title: 'A', is_primary: true }],
        },
      },
      {
        name: 'game',
        input: {
          メディアタイプ: 'game',
          原作タイプ: 'game_original',
          原作者有無: false,
          works: [{ title: 'B', is_primary: true }],
        },
      },
      {
        name: 'character',
        input: {
          メディアタイプ: 'character',
          原作タイプ: 'character_brand',
          原作者有無: false,
          works: [{ title: 'C', is_primary: true }],
        },
      },
      {
        name: 'multi',
        input: {
          メディアタイプ: 'anime',
          原作タイプ: 'manga_based',
          works: [
            { title: 'D', is_primary: true },
            { title: 'E', is_primary: false },
          ],
        },
      },
      {
        name: 'generic',
        input: { works: [{ title: 'F', is_primary: true }] },
      },
    ];

    for (const { name, input } of cases) {
      const result = await service.generate(makeInput(input));
      expect(result.slots.mediaForm).toBeTruthy();
      expect(result.slots.mediaForm.length).toBeGreaterThan(0);
      expect(result.slots.workTitle).toBeTruthy();
      expect(result.slots.workTitle.length).toBeGreaterThan(0);
      // 補足 log で pattern name を残す (regression の際に見つけやすく)
      if (!result.slots.mediaForm || !result.slots.workTitle) {
        throw new Error(`Slot regression in ${name} pattern: ${JSON.stringify(result.slots)}`);
      }
    }
  });
});

// ============================================================================
// describe 8: P5 regression (novel_based → 「ライトノベル」表現、「漫画」誤生成しない)
// ============================================================================

describe('LeadGeneratorService - P5 regression (原作タイプ novel_based → ライトノベル)', () => {
  it('原作タイプ novel_based + メディアタイプ anime → 「ライトノベル」で表現される', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime', // Sprint C-α で「漫画」誤生成の元凶
        原作タイプ: 'novel_based',
        原作者有無: true,
        原作者名: '日向夏先生',
        キャラクター名: ['猫猫', '壬氏'],
        works: [{ title: '薬屋のひとりごと', is_primary: true }],
      })
    );

    // P5 fix: 原作タイプ novel_based を優先して 「ライトノベル」で表現
    // (slot 抽出レベルで「ライトノベル」を保持。現行 01-lead.yaml v3.3.0 の
    //  lead_author_with_characters テンプレは本文に {{メディア形態表記}} を含まないため、
    //  leadMdx に「ライトノベル」文字列が出現するかはテンプレ改修依存 = Sprint C-β P11
    //  Phase 4 で Templates YAML 本文にも埋め込む余地あり)
    expect(result.slots.mediaForm).toBe('ライトノベル');
    expect(result.slots.mediaForm).not.toBe('漫画');
    // 「人気漫画「薬屋のひとりごと」」誤生成の regression 防止 (leadMdx 本文レベル)
    expect(result.leadMdx).not.toContain('人気漫画');
  });
});

// ============================================================================
// describe 9: §6.1 regression (character 区切り「、」+ 内部中黒保持)
// ============================================================================

describe('LeadGeneratorService - §6.1 regression (character 区切り「、」+ 内部中黒保持)', () => {
  it('キャラ間は「、」区切り、キャラ名内部の中黒「・」は保持', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'anime',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: '諫山創先生',
        キャラクター名: ['エレン・イェーガー', 'ミカサ・アッカーマン', 'アルミン・アルレルト'],
        works: [{ title: '進撃の巨人', is_primary: true }],
      })
    );

    // §6.1: キャラ間は「、」で区切る
    expect(result.leadMdx).toContain('エレン・イェーガー、ミカサ・アッカーマン、アルミン・アルレルト');
    // 旧「・」全繋ぎ regression 防止
    expect(result.leadMdx).not.toContain(
      'エレン・イェーガー・ミカサ・アッカーマン・アルミン・アルレルト'
    );
  });
});

// ============================================================================
// describe 10: N2 regression (英語 slug 漏れなし、日本語対訳が leadMdx に出現)
// ============================================================================

describe('LeadGeneratorService - N2 regression (英語 slug 漏れなし、日本語対訳が出現)', () => {
  it('メディアタイプ manga → leadMdx に「manga」英語 slug が漏れない', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'manga',
        原作タイプ: 'manga_based',
        原作者有無: true,
        原作者名: 'X先生',
        works: [{ title: 'テスト漫画', is_primary: true }],
      })
    );

    expect(result.leadMdx).not.toMatch(/manga|character|anime_movie/i);
    expect(result.leadMdx).toContain('漫画');
  });

  it('原作タイプ character_brand → leadMdx に「character」英語 slug が漏れない', async () => {
    const result = await service.generate(
      makeInput({
        メディアタイプ: 'character',
        原作タイプ: 'character_brand',
        原作者有無: false,
        works: [{ title: 'テストキャラクター', is_primary: true }],
      })
    );

    expect(result.leadMdx).not.toMatch(/character|anime_movie/i);
    expect(result.leadMdx).toContain('キャラクター');
  });
});

// ============================================================================
// describe 11: Fallback 経路 (LLM 未 DI 時に lead_generic 強制採用)
// ============================================================================

describe('LeadGeneratorService - Fallback 経路 (LLM 未 DI 時)', () => {
  // NOTE: Fallback を意図的に発火させるには、テンプレート内の未置換
  // {{変数}} が閾値超えするような input が必要。本 Layer 1 test では
  // Fallback 発火の real path は Phase 2f Layer 2 contract test で
  // provider mock を DI してテストする。ここでは fallback method の
  // 存在と signature 確認のみに留める (via LEAD_FALLBACK_TEMPLATE_ID の export)。

  it('LEAD_FALLBACK_TEMPLATE_ID sentinel が正常 export されている', () => {
    expect(LEAD_FALLBACK_TEMPLATE_ID).toBe('__fallback__');
  });
});

// ============================================================================
// describe 12: drift guard (R2 Minor #3、01-lead.yaml ⇔ TS table 対応検証)
// ============================================================================
//
// CONDITION_PREDICATES / SLOT_DEFINITIONS は 01-lead.yaml の conditions[] / templates:
// と 1:1 で hand-maintained されている parallel table。YAML 側で新 condition や template
// を追加/削除しても、TS 側の table 更新漏れは既存 26 case unit test では検出されない
// (test 対象外の新 id は unit test に asserted されないため silent drift となる)。
// 本 drift guard test で YAML と TS の対応 (双方向) を自動検証する。
// pipeline-steps.test.ts の drift guard と同 pattern。

describe('LeadGeneratorService - drift guard (01-lead.yaml ⇔ TS table 対応)', () => {
  let yamlConditionIds: string[];
  let yamlTemplateIds: string[];

  beforeAll(() => {
    // 直接 YAML を Read して conditions[].id / templates keys を抽出
    const yaml = jest.requireActual<typeof import('js-yaml')>('js-yaml');
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const yamlContent = fs.readFileSync(leadYamlPath, 'utf-8');
    const parsed = yaml.load(yamlContent) as {
      conditions?: Array<{ id: string; template: string }>;
      templates?: Record<string, string>;
    };
    yamlConditionIds = (parsed.conditions ?? []).map((c) => c.id);
    yamlTemplateIds = Object.keys(parsed.templates ?? {});
  });

  it('YAML conditions[].id は全て CONDITION_PREDICATES に entry を持つ (YAML → TS drift)', () => {
    const missing = yamlConditionIds.filter(
      (id) => !(id in __INTERNAL_CONDITION_PREDICATES__)
    );
    expect(missing).toEqual([]);
  });

  it('CONDITION_PREDICATES の key は全て YAML conditions[].id に対応する (TS → YAML drift)', () => {
    const tsKeys = Object.keys(__INTERNAL_CONDITION_PREDICATES__);
    const orphan = tsKeys.filter((id) => !yamlConditionIds.includes(id));
    expect(orphan).toEqual([]);
  });

  it('YAML templates: の key は全て SLOT_DEFINITIONS に entry を持つ (YAML → TS drift)', () => {
    const missing = yamlTemplateIds.filter(
      (id) => !(id in __INTERNAL_SLOT_DEFINITIONS__)
    );
    expect(missing).toEqual([]);
  });

  it('SLOT_DEFINITIONS の key は全て YAML templates: に対応する (TS → YAML drift)', () => {
    const tsKeys = Object.keys(__INTERNAL_SLOT_DEFINITIONS__);
    const orphan = tsKeys.filter((id) => !yamlTemplateIds.includes(id));
    expect(orphan).toEqual([]);
  });
});
