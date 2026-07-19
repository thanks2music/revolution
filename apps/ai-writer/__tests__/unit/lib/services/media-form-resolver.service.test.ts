/**
 * Layer 1 tests for MediaFormResolverService (Sprint C-β P11).
 *
 * Focus:
 * - §6.2 対訳マップ準拠の解決優先度: 原作タイプ 16 種優先 → メディアタイプ 14 種 fallback → 「作品」
 * - 曖昧値 (studio_production / original_with_creator / other) の fallback 挙動
 * - null / undefined edge case
 * - config YAML の実 parse (integration-style、本物の media-type-mapping.yaml を Read)
 */

import * as path from 'path';

import {
  MediaFormResolverService,
  resetMediaFormResolverService,
} from '../../../../lib/services/media-form-resolver.service';

// Sprint C-β P11 (2026-07-19) SoC §4.2: config now lives under templates/config/
// (synced from revolution-templates side via `pnpm sync:templates`).
const configPath = path.join(
  __dirname,
  '../../../../templates/config/media-type-mapping.yaml'
);

let resolver: MediaFormResolverService;

beforeAll(() => {
  resolver = new MediaFormResolverService(configPath);
});

afterAll(() => {
  resetMediaFormResolverService();
});

describe('MediaFormResolverService - config YAML parsing', () => {
  it('loads and validates media-type-mapping.yaml (Sprint C-β P11 拡張版)', () => {
    // constructor で throw されずに ここまで到達すれば parse は成功
    expect(resolver.getVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('provides original_type_labels for all 16 source types', () => {
    const labels = resolver.getOriginalTypeLabels();
    expect(labels).toHaveProperty('manga_based', '漫画');
    expect(labels).toHaveProperty('novel_based', 'ライトノベル');
    expect(labels).toHaveProperty('character_brand', 'キャラクター');
    expect(labels).toHaveProperty('vocaloid_character', 'バーチャル・シンガー');
    expect(labels).toHaveProperty('idol', 'アイドル');
    // 曖昧値は null (fallback 指示)
    expect(labels.studio_production).toBeNull();
    expect(labels.original_with_creator).toBeNull();
    expect(labels.other).toBeNull();
  });
});

describe('MediaFormResolverService.resolve - 原作タイプ優先 (Step 1)', () => {
  it('resolves manga_based → 漫画 (原作タイプ優先、メディアタイプ anime でも「漫画」)', () => {
    expect(resolver.resolve('manga_based', 'anime')).toBe('漫画');
  });

  it('resolves novel_based → ライトノベル (P5 解消、原作タイプ novel_based → 「漫画」誤生成を防止)', () => {
    expect(resolver.resolve('novel_based', 'anime')).toBe('ライトノベル');
  });

  it('resolves character_brand → キャラクター', () => {
    expect(resolver.resolve('character_brand', 'character')).toBe('キャラクター');
  });

  it('resolves vocaloid_character → バーチャル・シンガー', () => {
    expect(resolver.resolve('vocaloid_character', 'vocaloid')).toBe('バーチャル・シンガー');
  });

  it('resolves original_anime → アニメ', () => {
    expect(resolver.resolve('original_anime', 'anime')).toBe('アニメ');
  });

  it('resolves idol → アイドル (§6.2 準拠、G9 verified)', () => {
    expect(resolver.resolve('idol', 'idol')).toBe('アイドル');
  });

  it('resolves game_creator_based → ゲーム', () => {
    expect(resolver.resolve('game_creator_based', 'game')).toBe('ゲーム');
  });

  it('resolves illustrator_based → イラスト', () => {
    expect(resolver.resolve('illustrator_based', 'other')).toBe('イラスト');
  });

  it('resolves music_creator_based → 楽曲', () => {
    expect(resolver.resolve('music_creator_based', 'other')).toBe('楽曲');
  });

  it('resolves youtuber → YouTuber', () => {
    expect(resolver.resolve('youtuber', 'youtuber')).toBe('YouTuber');
  });

  it('resolves voice_actor → 声優', () => {
    expect(resolver.resolve('voice_actor', 'voice_actor')).toBe('声優');
  });

  it('resolves tokusatsu → 特撮', () => {
    expect(resolver.resolve('tokusatsu', 'tokusatsu')).toBe('特撮');
  });

  it('resolves game_original → ゲーム', () => {
    expect(resolver.resolve('game_original', 'game')).toBe('ゲーム');
  });
});

describe('MediaFormResolverService.resolve - 曖昧値のメディアタイプ fallback (Step 2)', () => {
  it('studio_production (null) + anime_movie → アニメ映画 (メディアタイプ fallback)', () => {
    expect(resolver.resolve('studio_production', 'anime_movie')).toBe('アニメ映画');
  });

  it('studio_production (null) + movie → 映画 (トイストーリー等の実写・CG映画)', () => {
    expect(resolver.resolve('studio_production', 'movie')).toBe('映画');
  });

  it('original_with_creator (null) + anime → アニメ', () => {
    expect(resolver.resolve('original_with_creator', 'anime')).toBe('アニメ');
  });

  it('other (null) + character → キャラクター', () => {
    expect(resolver.resolve('other', 'character')).toBe('キャラクター');
  });

  it('other (null) + drama → ドラマ', () => {
    expect(resolver.resolve('other', 'drama')).toBe('ドラマ');
  });
});

describe('MediaFormResolverService.resolve - 未指定 / null / undefined edge', () => {
  it('resolves undefined 原作タイプ + defined メディアタイプ → メディアタイプ label', () => {
    expect(resolver.resolve(undefined, 'character')).toBe('キャラクター');
  });

  it('resolves null 原作タイプ + defined メディアタイプ → メディアタイプ label', () => {
    expect(resolver.resolve(null, 'manga')).toBe('漫画');
  });

  it('resolves undefined 原作タイプ + undefined メディアタイプ → 「作品」 (final fallback)', () => {
    expect(resolver.resolve(undefined, undefined)).toBe('作品');
  });

  it('resolves null 原作タイプ + null メディアタイプ → 「作品」 (final fallback)', () => {
    expect(resolver.resolve(null, null)).toBe('作品');
  });

  it('resolves unknown 原作タイプ + unknown メディアタイプ → 「作品」 (final fallback)', () => {
    expect(resolver.resolve('unknown_type', 'unknown_media')).toBe('作品');
  });

  it('resolves unknown 原作タイプ + defined メディアタイプ → メディアタイプ label', () => {
    // 未知の原作タイプは skip、メディアタイプにフォールバック
    expect(resolver.resolve('unknown_type', 'anime')).toBe('アニメ');
  });

  it('resolves defined 原作タイプ + unknown メディアタイプ → 原作タイプ label (原作タイプ優先で match)', () => {
    expect(resolver.resolve('manga_based', 'unknown_media')).toBe('漫画');
  });
});

describe('MediaFormResolverService.resolve - N2/P5 regression prevention', () => {
  it('N2 defense: character 原作 + character メディア → 「キャラクター」(英語 slug 漏れなし)', () => {
    const result = resolver.resolve('character_brand', 'character');
    expect(result).not.toMatch(/character/i);
    expect(result).toBe('キャラクター');
  });

  it('N2 defense: manga_based + manga → 「漫画」(英語 slug 漏れなし)', () => {
    const result = resolver.resolve('manga_based', 'manga');
    expect(result).not.toMatch(/manga/i);
    expect(result).toBe('漫画');
  });

  it('N2 defense: studio_production + anime_movie → 「アニメ映画」(英語 slug 漏れなし)', () => {
    const result = resolver.resolve('studio_production', 'anime_movie');
    expect(result).not.toMatch(/anime/i);
    expect(result).toBe('アニメ映画');
  });

  it('P5 fix: novel_based → 「ライトノベル」 not 「漫画」 (誤判定防止)', () => {
    expect(resolver.resolve('novel_based', 'anime')).toBe('ライトノベル');
    expect(resolver.resolve('novel_based', 'manga')).toBe('ライトノベル');
    expect(resolver.resolve('novel_based', undefined)).toBe('ライトノベル');
  });
});
