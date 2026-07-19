/**
 * Layer 1 tests for media-form-mapping schema (§6.2 対訳マップの canonical spec 検証).
 *
 * Focus:
 * - EXPECTED_ORIGINAL_TYPE_LABELS が SourceTypeEnum 全 16 種を網羅
 * - EXPECTED_MEDIA_TYPE_LABELS が MediaTypeEnum 全 15 種を網羅 (utaite 含む)
 * - `null` 値 (曖昧値の fallback 指示) が §6.2 定義通り (studio_production / original_with_creator / other)
 * - MediaFormMappingConfigSchema の schema shape が YAML config を parse できる
 */

import {
  EXPECTED_MEDIA_TYPE_LABELS,
  EXPECTED_ORIGINAL_TYPE_LABELS,
  MEDIA_FORM_FALLBACK_LABEL,
  MediaFormMappingConfigSchema,
} from '@revolution/schemas/media-form-mapping';
import { MediaTypeEnum, SourceTypeEnum } from '@revolution/schemas/extraction-response';

describe('EXPECTED_ORIGINAL_TYPE_LABELS (§6.2 原作タイプ 16 種)', () => {
  const allSourceTypes = SourceTypeEnum.options;

  it('covers all SourceTypeEnum members (16 種)', () => {
    expect(allSourceTypes).toHaveLength(16);
    for (const key of allSourceTypes) {
      expect(EXPECTED_ORIGINAL_TYPE_LABELS).toHaveProperty(key);
    }
  });

  it('declares fallback (null) for ambiguous types per §6.2', () => {
    // §6.2 定義: studio_production / original_with_creator / other はメディアタイプに依存
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.studio_production).toBeNull();
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.original_with_creator).toBeNull();
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.other).toBeNull();
  });

  it('provides direct Japanese labels for non-ambiguous types', () => {
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.manga_based).toBe('漫画');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.novel_based).toBe('ライトノベル');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.game_creator_based).toBe('ゲーム');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.illustrator_based).toBe('イラスト');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.music_creator_based).toBe('楽曲');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.original_anime).toBe('アニメ');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.game_original).toBe('ゲーム');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.character_brand).toBe('キャラクター');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.vocaloid_character).toBe('バーチャル・シンガー');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.youtuber).toBe('YouTuber');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.idol).toBe('アイドル');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.voice_actor).toBe('声優');
    expect(EXPECTED_ORIGINAL_TYPE_LABELS.tokusatsu).toBe('特撮');
  });
});

describe('EXPECTED_MEDIA_TYPE_LABELS (§6.2 メディアタイプ 15 種、utaite 含む)', () => {
  const allMediaTypes = MediaTypeEnum.options;

  it('covers all MediaTypeEnum members (15 種、utaite 含む)', () => {
    expect(allMediaTypes).toHaveLength(15);
    for (const key of allMediaTypes) {
      expect(EXPECTED_MEDIA_TYPE_LABELS).toHaveProperty(key);
    }
  });

  it('provides §6.2 準拠 label values', () => {
    expect(EXPECTED_MEDIA_TYPE_LABELS.anime).toBe('アニメ');
    expect(EXPECTED_MEDIA_TYPE_LABELS.anime_movie).toBe('アニメ映画');
    expect(EXPECTED_MEDIA_TYPE_LABELS.manga).toBe('漫画');
    expect(EXPECTED_MEDIA_TYPE_LABELS.game).toBe('ゲーム');
    expect(EXPECTED_MEDIA_TYPE_LABELS.vtuber).toBe('VTuber');
    expect(EXPECTED_MEDIA_TYPE_LABELS.youtuber).toBe('YouTuber');
    // §6.2 準拠、Sprint C-β P11 G9 verified: 'アイドルグループ' ではなく 'アイドル'
    expect(EXPECTED_MEDIA_TYPE_LABELS.idol).toBe('アイドル');
    expect(EXPECTED_MEDIA_TYPE_LABELS.utaite).toBe('歌い手');
    expect(EXPECTED_MEDIA_TYPE_LABELS.voice_actor).toBe('声優');
    expect(EXPECTED_MEDIA_TYPE_LABELS.vocaloid).toBe('バーチャル・シンガー');
    expect(EXPECTED_MEDIA_TYPE_LABELS.character).toBe('キャラクター');
    expect(EXPECTED_MEDIA_TYPE_LABELS.movie).toBe('映画');
    expect(EXPECTED_MEDIA_TYPE_LABELS.drama).toBe('ドラマ');
    expect(EXPECTED_MEDIA_TYPE_LABELS.tokusatsu).toBe('特撮');
  });

  it('provides fallback label for "other" media type', () => {
    expect(EXPECTED_MEDIA_TYPE_LABELS.other).toBe('作品');
  });
});

describe('MEDIA_FORM_FALLBACK_LABEL', () => {
  it('is the ultimate fallback per §6.2', () => {
    expect(MEDIA_FORM_FALLBACK_LABEL).toBe('作品');
  });
});

describe('MediaFormMappingConfigSchema', () => {
  /**
   * Zod v4 の `z.record(z.enum([...]), value)` は exhaustive record (全 enum values を key として要求)。
   * media_type_mappings は 15 keys (utaite 含む)、original_type_labels は 16 keys 全て必須。
   * `EXPECTED_MEDIA_TYPE_LABELS` / `EXPECTED_ORIGINAL_TYPE_LABELS` の canonical map をベースに mock を組む。
   */
  const validConfig = {
    version: '2.0.0',
    last_updated: '2026-07-19',
    media_type_mappings: Object.fromEntries(
      Object.entries(EXPECTED_MEDIA_TYPE_LABELS).map(([key, label]) => [
        key,
        {
          label,
          character_separator: key === 'idol' || key === 'utaite' ? ' / ' : '、',
          description: `${label} test entry`,
        },
      ])
    ),
    original_type_labels: EXPECTED_ORIGINAL_TYPE_LABELS,
    separator_rules: {
      default: '、',
      idol_utaite: ' / ',
      reason: 'test',
    },
  };

  it('parses a valid config', () => {
    const result = MediaFormMappingConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects invalid semver in version', () => {
    const result = MediaFormMappingConfigSchema.safeParse({ ...validConfig, version: '1.6' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format in last_updated', () => {
    const result = MediaFormMappingConfigSchema.safeParse({
      ...validConfig,
      last_updated: '2026/07/19',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown media type slug in media_type_mappings', () => {
    const result = MediaFormMappingConfigSchema.safeParse({
      ...validConfig,
      media_type_mappings: {
        unknown_media_type: { label: 'unknown', character_separator: '、' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty label in a mapping entry', () => {
    const result = MediaFormMappingConfigSchema.safeParse({
      ...validConfig,
      media_type_mappings: {
        anime: { label: '', character_separator: '、' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts null values in original_type_labels for ambiguous fallback indicators', () => {
    // exhaustive record を維持しつつ、null 値の許容を検証
    // (canonical EXPECTED_ORIGINAL_TYPE_LABELS が既に null を含むので、その parse が成功すれば十分)
    const result = MediaFormMappingConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.original_type_labels.studio_production).toBeNull();
      expect(result.data.original_type_labels.original_with_creator).toBeNull();
      expect(result.data.original_type_labels.other).toBeNull();
    }
  });
});
