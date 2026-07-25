/**
 * @fileoverview Media Type Mapper Service for v1.4.0
 *
 * @description
 * メディアタイプ別のキャラクター/メンバーセパレーター設定を提供するサービス。
 * YAML設定ファイルから読み込み、キャッシュして使用します。
 *
 * ## 主な機能
 * - メディアタイプ別セパレーター取得（"、" または " / "、§6.1 準拠）
 * - メディアタイプ表示ラベル取得 (§6.2 準拠)
 * - idol/utaite判定（特殊セパレーター対象）
 *
 * ## 重要な仕様
 * - **原作者名には適用されません**（常に " / " 固定）
 * - キャラクター名・メンバー名にのみ適用されます
 * - Singletonパターンで実装（アプリ全体で1インスタンス）
 * - §6.1 (2026-07-18 訂正、Sprint C-β P11 で "・" → "、" default 化): キャラ間区切りは「、」、
 *   キャラ名内部の中黒「・」(エレン・イェーガー等) は保持。idol/utaite の実メンバー名区切りのみ " / "
 *
 * @example
 * const mapper = getMediaTypeMapperService();
 *
 * // セパレーター取得
 * mapper.getSeparator('idol')   // → ' / '
 * mapper.getSeparator('anime')  // → '、'
 *
 * // idol/utaite判定
 * mapper.isIdolOrUtaite('idol')   // → true
 * mapper.isIdolOrUtaite('anime')  // → false
 *
 * // ラベル取得 (§6.2 準拠)
 * mapper.getLabel('idol')  // → 'アイドル'
 * mapper.getLabel('character')  // → 'キャラクター'
 *
 * @see /notes/archive/v1.4.0-design-draft.md
 * @see /config/media-type-mapping.yaml
 * @see revolution-templates/CLAUDE.md §主要な設計パターン §6.1 (キャラクター名の処理) + §6.2 (メディア形態表記マップ)
 * @since v1.4.0
 * @changelog Sprint C-β P11 (2026-07-19): character_separator default "・" → "、" 変更 (§6.1)。
 *            §6.2 メディア形態表記マップの `original_type_labels` は姉妹サービス
 *            `MediaFormResolverService` が解決する。
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * メディアタイプ設定の型定義
 */
export interface MediaTypeMapping {
  /** メディアタイプの表示ラベル（日本語） */
  label: string;
  /** キャラクター/メンバー名の結合セパレーター */
  character_separator: string;
  /** 説明文（オプション） */
  description?: string;
  /** 備考（オプション） */
  notes?: string;
}

/**
 * YAML設定ファイル全体の型定義
 */
export interface MediaTypeMappingConfig {
  /** 設定ファイルのバージョン */
  version: string;
  /** 最終更新日 */
  last_updated: string;
  /** メディアタイプマッピング */
  media_type_mappings: {
    [mediaType: string]: MediaTypeMapping;
  };
  /** セパレータールール説明（オプション） */
  separator_rules?: {
    default: string;
    idol_utaite: string;
    reason: string;
  };
  /** 原作者名の扱い（オプション） */
  author_name_rules?: {
    separator: string;
    applies_to_media_types: boolean;
    reason: string;
  };
}

/**
 * MediaTypeMapping の Zod スキーマ
 */
const MediaTypeMappingSchema = z.object({
  label: z
    .string()
    .min(1, 'Label must not be empty')
    .max(20, 'Label must be 20 characters or less'),
  character_separator: z
    .string()
    .min(1, 'Character separator must not be empty')
    .max(10, 'Character separator must be 10 characters or less'),
  description: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * MediaTypeMappingConfig の Zod スキーマ
 */
const MediaTypeMappingConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (e.g., "1.0.0")'),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  media_type_mappings: z
    .record(z.string(), MediaTypeMappingSchema)
    .refine(
      (mappings) => Object.keys(mappings).length > 0,
      'At least one media type mapping is required'
    ),
  separator_rules: z
    .object({
      default: z.string(),
      idol_utaite: z.string(),
      reason: z.string(),
    })
    .optional(),
  author_name_rules: z
    .object({
      separator: z.string(),
      applies_to_media_types: z.boolean(),
      reason: z.string(),
    })
    .optional(),
});

/**
 * Media Type Mapper Service
 *
 * @description
 * YAML設定ファイルから読み込んだメディアタイプマッピングを管理し、
 * セパレーターやラベル情報を提供します。
 *
 * ## Singleton Pattern
 * アプリケーション全体で1つのインスタンスのみ存在します。
 * `getMediaTypeMapperService()` 関数経由でアクセスしてください。
 *
 * @class MediaTypeMapperService
 */
export class MediaTypeMapperService {
  private config: MediaTypeMappingConfig;
  private configPath: string;

  /**
   * コンストラクタ
   *
   * @param configPath - YAML設定ファイルのパス（オプション、テスト用）
   *
   * @throws {Error} YAML設定ファイルが見つからない場合
   * @throws {Error} YAML設定ファイルのフォーマットが不正な場合
   * @throws {Error} 必須フィールドが不足している場合
   */
  constructor(configPath?: string) {
    // Sprint C-β P11 (2026-07-19) SoC §4.2 alignment: config source of truth is Templates side
    // (`revolution-templates/ai-writer/config/media-type-mapping.yaml`), synced to
    // `apps/ai-writer/templates/config/` by `pnpm sync:templates`. The legacy path
    // `apps/ai-writer/config/media-type-mapping.yaml` is removed as part of the same sprint.
    this.configPath =
      configPath ||
      path.join(process.cwd(), 'templates', 'config', 'media-type-mapping.yaml');

    // YAML設定ファイルを読み込み
    if (!fs.existsSync(this.configPath)) {
      throw new Error(
        `Media type mapping config not found: ${this.configPath}\n` +
          'Please ensure the Templates repository has been synced via `pnpm sync:templates`.'
      );
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf-8');
      this.config = yaml.load(fileContent) as MediaTypeMappingConfig;

      // YAML構造の基本チェック
      if (!this.config || typeof this.config !== 'object') {
        throw new Error('Invalid YAML structure: config must be an object');
      }

      // 設定ファイルのバリデーション
      this.validateConfig();
    } catch (error) {
      // YAMLパースエラーの場合
      if (error instanceof yaml.YAMLException) {
        throw new Error(
          `YAML syntax error in media-type-mapping.yaml:\n` +
            `  Line ${error.mark.line + 1}, Column ${error.mark.column + 1}\n` +
            `  ${error.reason}\n` +
            `Please check YAML syntax.`
        );
      }

      // その他のエラーは再スロー
      throw error;
    }
  }

  /**
   * YAML設定ファイルのバリデーション
   *
   * @private
   * @throws {Error} 必須フィールドが不足している場合
   * @throws {Error} フォーマットが不正な場合
   *
   * @description
   * Zod スキーマを使用して設定ファイルの厳密な検証を行います。
   * 以下の項目を検証:
   * - 必須フィールドの存在チェック
   * - セパレーターの長さチェック
   * - ラベルの長さチェック
   * - バージョン形式チェック (semver)
   * - 日付形式チェック (YYYY-MM-DD)
   */
  private validateConfig(): void {
    try {
      // Zodによる厳密な検証
      MediaTypeMappingConfigSchema.parse(this.config);
    } catch (error) {
      // Zodエラーの場合、人間が読みやすい形式に変換
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map((err: z.ZodIssue) => {
            const path = err.path.join('.');
            return `  - ${path}: ${err.message}`;
          })
          .join('\n');

        throw new Error(
          `Invalid media-type-mapping.yaml:\n` +
            `${errorMessages}\n` +
            `Please fix the configuration file.`
        );
      }

      // その他のエラーは再スロー
      throw error;
    }
  }

  /**
   * キャラクター/メンバー名の結合セパレーターを取得
   *
   * @param mediaType - メディアタイプ（例: 'idol', 'anime'）
   * @returns セパレーター文字列（'、' または ' / '、§6.1 準拠）
   *
   * @description
   * - idol/utaite → ' / ' (実メンバー名区切り、業界慣例)
   * - その他 → '、' (§6.1 訂正、キャラクター名内部の中黒「・」は保持)
   * - 未定義のメディアタイプ → '、' (デフォルト、Sprint C-β P11 で "・" → "、" 変更)
   *
   * @example
   * mapper.getSeparator('idol')   // → ' / '
   * mapper.getSeparator('anime')  // → '、'
   * mapper.getSeparator('unknown') // → '、' (デフォルト)
   */
  getSeparator(mediaType: string): string {
    return this.config.media_type_mappings[mediaType]?.character_separator || '、';
  }

  /**
   * メディアタイプの表示ラベルを取得
   *
   * @param mediaType - メディアタイプ（例: 'idol', 'anime'）
   * @returns 日本語ラベル（例: 'アイドル', 'アニメ'）
   *
   * @description
   * 未定義のメディアタイプの場合は、そのまま返却します。
   *
   * @example
   * mapper.getLabel('idol')    // → 'アイドル'
   * mapper.getLabel('anime')   // → 'アニメ'
   * mapper.getLabel('unknown') // → 'unknown'
   */
  getLabel(mediaType: string): string {
    return this.config.media_type_mappings[mediaType]?.label || mediaType;
  }

  /**
   * idol または utaite のメディアタイプかチェック
   *
   * @param mediaType - メディアタイプ
   * @returns idol/utaiteの場合true
   *
   * @description
   * このメソッドは、特殊セパレーター（' / '）を使用するメディアタイプを判定します。
   * 現在は idol と utaite のみが対象です。
   *
   * @remarks
   * 将来的に vtuber も追加される可能性があります。
   *
   * @example
   * mapper.isIdolOrUtaite('idol')   // → true
   * mapper.isIdolOrUtaite('utaite') // → true
   * mapper.isIdolOrUtaite('anime')  // → false
   */
  isIdolOrUtaite(mediaType: string): boolean {
    return mediaType === 'idol' || mediaType === 'utaite';
  }

  /**
   * すべてのメディアタイプマッピングを取得
   *
   * @returns メディアタイプマッピング全体
   *
   * @description
   * デバッグやテスト用途で使用。通常のアプリケーションコードでは
   * `getSeparator()` や `getLabel()` を使用してください。
   *
   * @example
   * const allMappings = mapper.getAllMappings();
   * console.log(allMappings['idol']); // → { label: 'アイドル', character_separator: ' / ', ... }
   */
  getAllMappings(): { [mediaType: string]: MediaTypeMapping } {
    return this.config.media_type_mappings;
  }

  /**
   * 設定ファイルのバージョン情報を取得
   *
   * @returns バージョン番号
   *
   * @description
   * デバッグやログ出力用。
   *
   * @example
   * console.log(`Config version: ${mapper.getVersion()}`); // → 'Config version: 1.0.0'
   */
  getVersion(): string {
    return this.config.version;
  }
}

/**
 * Singleton instance
 */
let mediaTypeMapperInstance: MediaTypeMapperService | null = null;

/**
 * MediaTypeMapperService のシングルトンインスタンスを取得
 *
 * @returns MediaTypeMapperService インスタンス
 *
 * @description
 * アプリケーション全体で1つのインスタンスのみ存在します。
 * 初回呼び出し時にYAML設定ファイルを読み込み、以降はキャッシュされたインスタンスを返します。
 *
 * @example
 * const mapper = getMediaTypeMapperService();
 * const separator = mapper.getSeparator('idol'); // → ' / '
 */
export function getMediaTypeMapperService(): MediaTypeMapperService {
  if (!mediaTypeMapperInstance) {
    mediaTypeMapperInstance = new MediaTypeMapperService();
  }
  return mediaTypeMapperInstance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 *
 * @description
 * ユニットテストで異なる設定ファイルをテストする場合に使用。
 * 本番コードでは使用しないでください。
 *
 * @internal
 */
export function resetMediaTypeMapperService(): void {
  mediaTypeMapperInstance = null;
}

/**
 * 便利な export（既存コードとの互換性）
 */
export const mediaTypeMapperService = {
  get instance() {
    return getMediaTypeMapperService();
  },
};
