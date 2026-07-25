/**
 * @fileoverview MediaFormResolverService (Sprint C-β P11 導入、Sprint D Phase 2-a 反転仕様に更新)
 *
 * @description
 * §6.2 メディア形態表記マップに基づき、リード文 1 文目の [メディア形態] スロットに埋める
 * 日本語表記を解決するサービス。
 *
 * ## 解決優先度 (Sprint D Phase 2-a canonical spec、refined reversal)
 * 1. **メディアタイプ 14 種を優先** (anime → アニメ、manga → 漫画、character → キャラクター 等)
 *    - ただし media label が `'作品'` (generic fallback) の場合は Step 2 に進む
 * 2. 原作タイプ 16 種にフォールバック (曖昧値 = null 対訳は skip)
 * 3. 両方 miss / 未指定の場合は hardcoded '作品' を返す
 *
 * ## 反転の狙い (Sprint D Phase 2-a)
 * 呪術廻戦カフェ (`manga_based + anime`) 等のケースで、原作 label 「漫画」ではなく
 * メディア label 「アニメ」を採用することでコラボイベントの subject を正しく反映する。
 * `illustrator_based + other` 等の generic media label ケースでは原作 label にフォールバック
 * することで「イラスト」「楽曲」「ゲーム」などの precision を維持する (refined reversal)。
 *
 * ## Singleton
 * `MediaTypeMapperService` と同構造。`getMediaFormResolverService()` 経由でアクセス。
 *
 * @see revolution-templates/CLAUDE.md §主要な設計パターン §6.2 メディア形態表記マップ
 * @see revolution-templates/ai-writer/posts/yaml/collabo-cafe/shared/placeholders.yaml
 *      (メディア形態表記 派生変数の宣言)
 * @see MediaTypeMapperService (character_separator + label の既存 resolver)
 * @since Sprint C-β P11 (導入)、Sprint D Phase 2-a (反転仕様)
 */

import * as fs from 'fs';
import * as path from 'path';

import yaml from 'js-yaml';

import {
  MediaFormMappingConfigSchema,
  type MediaFormMappingConfig,
} from '@revolution/schemas/media-form-mapping';

/**
 * MediaFormResolverService
 *
 * @description
 * YAML 設定ファイルから読み込んだ §6.2 対訳マップを管理し、原作タイプ + メディアタイプの組から
 * リード文用の日本語表記を解決する (Sprint D Phase 2-a refined reversal 仕様)。
 *
 * ## 主な機能
 * - `resolve(原作タイプ?, メディアタイプ?)`: メディアタイプ優先 → 原作タイプ fallback → '作品'
 * - メディアタイプ label が `'作品'` (generic fallback) の場合は原作タイプにフォールバック
 * - 両方 miss / 未指定の場合は hardcoded '作品' を返す
 *
 * @class MediaFormResolverService
 */
export class MediaFormResolverService {
  private config: MediaFormMappingConfig;
  private configPath: string;

  constructor(configPath?: string) {
    // Sprint C-β P11 (2026-07-19) SoC §4.2 alignment: config source of truth is Templates side
    // (`revolution-templates/ai-writer/config/media-type-mapping.yaml`), synced to
    // `apps/ai-writer/templates/config/` by `pnpm sync:templates`.
    this.configPath =
      configPath ||
      path.join(process.cwd(), 'templates', 'config', 'media-type-mapping.yaml');

    if (!fs.existsSync(this.configPath)) {
      throw new Error(
        `Media type mapping config not found: ${this.configPath}\n` +
          'Please ensure the Templates repository has been synced via `pnpm sync:templates` ' +
          '(with original_type_labels section required for Sprint C-β P11 MediaFormResolverService).'
      );
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = yaml.load(fileContent);

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML structure: config must be an object');
      }

      // Zod で strict validation (original_type_labels 必須、Sprint C-β P11 拡張)
      this.config = MediaFormMappingConfigSchema.parse(parsed);
    } catch (error) {
      if (error instanceof yaml.YAMLException) {
        throw new Error(
          `YAML syntax error in media-type-mapping.yaml:\n` +
            `  Line ${error.mark.line + 1}, Column ${error.mark.column + 1}\n` +
            `  ${error.reason}\n` +
            `Please check YAML syntax.`
        );
      }
      throw error;
    }
  }

  /**
   * §6.2 対訳マップに基づいてリード文用の日本語表記を解決する (Sprint D Phase 2-a 反転仕様)。
   *
   * ## 解決優先度 (refined reversal)
   * 1. **メディアタイプ 14 種を優先** (label が有効かつ「作品」でない場合はそれを返す)
   * 2. メディア label が「作品」(generic fallback) or メディアタイプ未指定 / unknown の場合は
   *    原作タイプ 16 種にフォールバック (曖昧値 null 対訳は skip)
   * 3. 両方 miss / 未指定の場合は hardcoded '作品' を返す
   *
   * @param 原作タイプ - `SourceTypeEnum` の値 (manga_based / novel_based / ...) または undefined
   * @param メディアタイプ - `MediaTypeEnum` の値 (anime / manga / character / ...) または undefined
   * @returns リード文 [メディア形態] スロット用の日本語表記 (例: 「アニメ」「漫画」「イラスト」「作品」)
   *
   * @example
   * resolver.resolve('manga_based', 'anime')           // → 'アニメ' (呪術廻戦カフェ、メディアタイプ優先)
   * resolver.resolve('manga_based', 'manga')           // → '漫画' (D.Gray-man 漫画コラボ)
   * resolver.resolve('illustrator_based', 'other')     // → 'イラスト' (media '作品' skip → 原作 label)
   * resolver.resolve('studio_production', 'anime_movie') // → 'アニメ映画' (media label 有効)
   * resolver.resolve(undefined, 'character')           // → 'キャラクター' (原作未指定 → メディア label)
   * resolver.resolve(undefined, undefined)             // → '作品' (両方 miss)
   */
  resolve(原作タイプ?: string | null, メディアタイプ?: string | null): string {
    // Step 1: メディアタイプ優先 (label が「作品」= generic fallback の場合は Step 2 に進む)
    if (メディアタイプ) {
      const mediaTypeEntry = this.config.media_type_mappings[
        メディアタイプ as keyof typeof this.config.media_type_mappings
      ];
      if (mediaTypeEntry?.label && mediaTypeEntry.label !== '作品') {
        return mediaTypeEntry.label;
      }
      // media label === '作品' (generic fallback) or unknown メディアタイプ は Step 2 に進む
    }

    // Step 2: 原作タイプへフォールバック (曖昧値 = null 対訳は skip)
    if (原作タイプ) {
      const originalLabel = this.config.original_type_labels[
        原作タイプ as keyof typeof this.config.original_type_labels
      ];
      if (originalLabel) {
        return originalLabel;
      }
      // originalLabel === null は曖昧値 (studio_production / original_with_creator / other) の
      // fallback 指示、Step 3 (最終フォールバック) に進む
    }

    // Step 3: 両方 miss の最終フォールバック
    return '作品';
  }

  /**
   * §6.2 原作タイプ 16 種 → 日本語表記マップ全体を取得 (デバッグ / test 用)。
   */
  getOriginalTypeLabels(): MediaFormMappingConfig['original_type_labels'] {
    return this.config.original_type_labels;
  }

  /**
   * 設定ファイルのバージョン情報を取得。
   */
  getVersion(): string {
    return this.config.version;
  }
}

/**
 * Singleton instance
 */
let mediaFormResolverInstance: MediaFormResolverService | null = null;

/**
 * `MediaFormResolverService` の singleton instance を取得。
 */
export function getMediaFormResolverService(): MediaFormResolverService {
  if (!mediaFormResolverInstance) {
    mediaFormResolverInstance = new MediaFormResolverService();
  }
  return mediaFormResolverInstance;
}

/**
 * Singleton instance をリセット (テスト用、DI 差替用)。
 * @internal
 */
export function resetMediaFormResolverService(): void {
  mediaFormResolverInstance = null;
}
