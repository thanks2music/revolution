/**
 * Layer 1 tests for MediaFormResolverService (Sprint D Phase 2-a、refined reversal 反映)。
 *
 * Focus:
 * - Sprint D Phase 2-a canonical spec: **メディアタイプ優先 → 原作タイプ fallback → hardcoded '作品'**
 * - Refined reversal: メディアタイプ label が `'作品'` (generic fallback) の場合は Step 2 に進む
 *   = illustrator_based + other → 'イラスト' 等の原作タイプ固有 label 維持
 * - null / undefined edge / unknown skip / N2 英語 slug 漏れ防御
 * - config YAML の実 parse (integration-style、本物の media-type-mapping.yaml を Read)
 */

import * as fs from 'fs';
import * as os from 'os';
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

describe('MediaFormResolverService.resolve - メディアタイプ優先 (Step 1、Sprint D Phase 2-a 反転仕様)', () => {
  // Sprint D Phase 2-a canonical: メディアタイプ label が有効値 (非「作品」) の場合はそれを採用。
  // 呪術廻戦カフェ = manga_based + anime → 「アニメ」の実現がここの中核目的。

  it('resolves manga_based + anime → アニメ (呪術廻戦カフェ pattern、原作より媒体を優先)', () => {
    expect(resolver.resolve('manga_based', 'anime')).toBe('アニメ');
  });

  it('resolves manga_based + manga → 漫画 (D.Gray-man 漫画コラボ、原作・媒体一致で「漫画」)', () => {
    expect(resolver.resolve('manga_based', 'manga')).toBe('漫画');
  });

  it('resolves novel_based + anime → アニメ (小説原作アニメコラボ)', () => {
    // 旧 Sprint C-β P5 期待「ライトノベル」は Phase 2-a 反転で無効化
    expect(resolver.resolve('novel_based', 'anime')).toBe('アニメ');
  });

  it('resolves character_brand + character → キャラクター', () => {
    expect(resolver.resolve('character_brand', 'character')).toBe('キャラクター');
  });

  it('resolves vocaloid_character + vocaloid → バーチャル・シンガー', () => {
    expect(resolver.resolve('vocaloid_character', 'vocaloid')).toBe('バーチャル・シンガー');
  });

  it('resolves original_anime + anime → アニメ', () => {
    expect(resolver.resolve('original_anime', 'anime')).toBe('アニメ');
  });

  it('resolves idol + idol → アイドル', () => {
    expect(resolver.resolve('idol', 'idol')).toBe('アイドル');
  });

  it('resolves game_creator_based + game → ゲーム', () => {
    expect(resolver.resolve('game_creator_based', 'game')).toBe('ゲーム');
  });

  it('resolves youtuber + youtuber → YouTuber', () => {
    expect(resolver.resolve('youtuber', 'youtuber')).toBe('YouTuber');
  });

  it('resolves voice_actor + voice_actor → 声優', () => {
    expect(resolver.resolve('voice_actor', 'voice_actor')).toBe('声優');
  });

  it('resolves tokusatsu + tokusatsu → 特撮', () => {
    expect(resolver.resolve('tokusatsu', 'tokusatsu')).toBe('特撮');
  });

  it('resolves game_original + game → ゲーム', () => {
    expect(resolver.resolve('game_original', 'game')).toBe('ゲーム');
  });

  it('resolves studio_production + anime_movie → アニメ映画', () => {
    // 曖昧値 (original null) でもメディアタイプ label 優先
    expect(resolver.resolve('studio_production', 'anime_movie')).toBe('アニメ映画');
  });

  it('resolves studio_production + movie → 映画 (トイストーリー等の実写・CG映画)', () => {
    expect(resolver.resolve('studio_production', 'movie')).toBe('映画');
  });

  it('resolves original_with_creator + anime → アニメ (曖昧値 → メディアタイプ)', () => {
    expect(resolver.resolve('original_with_creator', 'anime')).toBe('アニメ');
  });

  it('resolves other + drama → ドラマ', () => {
    expect(resolver.resolve('other', 'drama')).toBe('ドラマ');
  });
});

describe('MediaFormResolverService.resolve - refined reversal: メディアタイプ「作品」時の原作タイプ fallback (Step 2)', () => {
  // Sprint D Phase 2-a canonical: media_type_mappings.other.label = '作品' は generic fallback とみなし、
  // 原作タイプ固有 label (イラスト / 楽曲 / ゲーム / キャラクター 等) にフォールバック。
  // 単純反転すると illustrator_based + other → '作品' に降格するため refined 導入。

  it('illustrator_based + other → イラスト (media label「作品」を skip、原作 label 採用)', () => {
    expect(resolver.resolve('illustrator_based', 'other')).toBe('イラスト');
  });

  it('music_creator_based + other → 楽曲 (media label「作品」を skip、原作 label 採用)', () => {
    expect(resolver.resolve('music_creator_based', 'other')).toBe('楽曲');
  });

  it('game_creator_based + other → ゲーム (media label「作品」を skip、原作 label 採用)', () => {
    expect(resolver.resolve('game_creator_based', 'other')).toBe('ゲーム');
  });

  it('character_brand + other → キャラクター (media label「作品」を skip、原作 label 採用)', () => {
    expect(resolver.resolve('character_brand', 'other')).toBe('キャラクター');
  });

  it('manga_based + other → 漫画 (media label「作品」を skip、原作 label 採用)', () => {
    expect(resolver.resolve('manga_based', 'other')).toBe('漫画');
  });

  it('manga_based + unknown_media → 漫画 (unknown skip、原作 label 採用)', () => {
    expect(resolver.resolve('manga_based', 'unknown_media')).toBe('漫画');
  });

  it('manga_based + null → 漫画 (メディアタイプ null、原作 label 採用)', () => {
    expect(resolver.resolve('manga_based', null)).toBe('漫画');
  });

  it('manga_based + undefined → 漫画 (メディアタイプ未指定、原作 label 採用)', () => {
    expect(resolver.resolve('manga_based', undefined)).toBe('漫画');
  });

  it('novel_based + undefined → ライトノベル (メディアタイプ未指定、原作 label 採用)', () => {
    expect(resolver.resolve('novel_based', undefined)).toBe('ライトノベル');
  });
});

describe('MediaFormResolverService.resolve - 最終フォールバック「作品」 (Step 3)', () => {
  // 両方が値を持たない or 両方 skip される場合のみ hardcoded '作品'。

  it('undefined + undefined → 作品 (両方未指定)', () => {
    expect(resolver.resolve(undefined, undefined)).toBe('作品');
  });

  it('null + null → 作品 (両方 null)', () => {
    expect(resolver.resolve(null, null)).toBe('作品');
  });

  it('unknown_type + unknown_media → 作品 (両方 unknown で skip)', () => {
    expect(resolver.resolve('unknown_type', 'unknown_media')).toBe('作品');
  });

  it('studio_production (null 原作) + undefined → 作品 (原作曖昧値 skip、メディア未指定)', () => {
    // 曖昧値の原作タイプ (null 対訳) は Step 2 で skip される
    expect(resolver.resolve('studio_production', undefined)).toBe('作品');
  });

  it('other (null 原作) + null → 作品', () => {
    expect(resolver.resolve('other', null)).toBe('作品');
  });

  it('undefined + other → 作品 (メディア label「作品」→ 原作未指定 → 最終フォールバック)', () => {
    // media_type_mappings.other.label = '作品' なので Step 1 skip、Step 2 で原作未指定 → Step 3
    expect(resolver.resolve(undefined, 'other')).toBe('作品');
  });
});

describe('MediaFormResolverService.resolve - unknown 原作タイプ + 有効メディアタイプ', () => {
  it('resolves unknown 原作タイプ + defined メディアタイプ → メディアタイプ label', () => {
    // 未知の原作タイプは Step 2 で skip、Step 1 のメディアタイプ hit を採用
    expect(resolver.resolve('unknown_type', 'anime')).toBe('アニメ');
  });

  it('resolves null 原作 + defined メディアタイプ → メディアタイプ label', () => {
    expect(resolver.resolve(null, 'manga')).toBe('漫画');
  });

  it('resolves undefined 原作 + defined メディアタイプ → メディアタイプ label', () => {
    expect(resolver.resolve(undefined, 'character')).toBe('キャラクター');
  });
});

describe('MediaFormResolverService.resolve - N2 英語 slug 漏れ防御 (Sprint C-β P11 由来、Phase 2-a 反転後も維持)', () => {
  // 反転後もリード文 [メディア形態] スロットに英語 slug が漏れないことを保証。
  // 反転により Step 1 で日本語ラベルが返るため、英語 slug 漏れリスクは構造的に低下。

  it('N2 defense: character_brand + character → キャラクター (英語 slug なし)', () => {
    const result = resolver.resolve('character_brand', 'character');
    expect(result).not.toMatch(/character/i);
    expect(result).toBe('キャラクター');
  });

  it('N2 defense: manga_based + manga → 漫画 (英語 slug なし)', () => {
    const result = resolver.resolve('manga_based', 'manga');
    expect(result).not.toMatch(/manga/i);
    expect(result).toBe('漫画');
  });

  it('N2 defense: studio_production + anime_movie → アニメ映画 (英語 slug なし)', () => {
    const result = resolver.resolve('studio_production', 'anime_movie');
    expect(result).not.toMatch(/anime/i);
    expect(result).toBe('アニメ映画');
  });

  it('N2 defense: manga_based + anime → アニメ (Phase 2-a 反転後、英語 slug なし)', () => {
    const result = resolver.resolve('manga_based', 'anime');
    expect(result).not.toMatch(/anime|manga/i);
    expect(result).toBe('アニメ');
  });
});

// ============================================================================
// describe: constructor error branches (R3 対応、Sprint C-β P11 由来、変更なし)
// ============================================================================

describe('MediaFormResolverService - constructor error branches (R3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-form-resolver-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('非存在 configPath で throw (fs.existsSync check)', () => {
    const missingPath = path.join(tmpDir, 'nonexistent.yaml');
    expect(() => new MediaFormResolverService(missingPath)).toThrow(
      /Media type mapping config not found/
    );
  });

  it('invalid YAML syntax で throw (yaml.YAMLException を捕捉して人間可読 error に変換)', () => {
    const badYamlPath = path.join(tmpDir, 'invalid.yaml');
    // 意図的に YAML syntax error を含む fixture (unclosed bracket + tab indentation)
    fs.writeFileSync(badYamlPath, 'media_type_mappings:\n  anime: [invalid syntax\n\tunexpected: tab', 'utf-8');
    expect(() => new MediaFormResolverService(badYamlPath)).toThrow();
  });

  it('Zod validation failure で throw (必須 field 欠落: original_type_labels なし)', () => {
    const incompleteYamlPath = path.join(tmpDir, 'incomplete.yaml');
    // 意図的に MediaFormMappingConfigSchema の必須 field (original_type_labels) を欠落させる
    fs.writeFileSync(
      incompleteYamlPath,
      'media_type_mappings:\n  anime:\n    label: "アニメ"\n    character_separator: "、"\n',
      'utf-8'
    );
    expect(() => new MediaFormResolverService(incompleteYamlPath)).toThrow();
  });
});
