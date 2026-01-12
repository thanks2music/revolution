/**
 * @fileoverview Media Type Mapper Service for v1.4.0
 *
 * @description
 * メディアタイプ別のキャラクター/メンバーセパレーター設定を提供するサービス。
 * YAML設定ファイルから読み込み、キャッシュして使用します。
 *
 * ## 主な機能
 * - メディアタイプ別セパレーター取得（"・" または " / "）
 * - メディアタイプ表示ラベル取得
 * - idol/utaite判定（特殊セパレーター対象）
 *
 * ## 重要な仕様
 * - **原作者名には適用されません**（常に " / " 固定）
 * - キャラクター名・メンバー名にのみ適用されます
 * - Singletonパターンで実装（アプリ全体で1インスタンス）
 *
 * @example
 * const mapper = getMediaTypeMapperService();
 *
 * // セパレーター取得
 * mapper.getSeparator('idol')   // → ' / '
 * mapper.getSeparator('anime')  // → '・'
 *
 * // idol/utaite判定
 * mapper.isIdolOrUtaite('idol')   // → true
 * mapper.isIdolOrUtaite('anime')  // → false
 *
 * // ラベル取得
 * mapper.getLabel('idol')  // → 'アイドル'
 *
 * @see /notes/04-review/2026-01-12-01-v1.4.0設計草案v1-修正版.md
 * @see /config/media-type-mapping.yaml
 * @since v1.4.0
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

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
    this.configPath =
      configPath || path.join(process.cwd(), 'config', 'media-type-mapping.yaml');

    // YAML設定ファイルを読み込み
    if (!fs.existsSync(this.configPath)) {
      throw new Error(
        `Media type mapping config not found: ${this.configPath}\n` +
          'Please ensure config/media-type-mapping.yaml exists.'
      );
    }

    const fileContent = fs.readFileSync(this.configPath, 'utf-8');
    this.config = yaml.load(fileContent) as MediaTypeMappingConfig;

    // 設定ファイルのバリデーション
    this.validateConfig();
  }

  /**
   * YAML設定ファイルのバリデーション
   *
   * @private
   * @throws {Error} 必須フィールドが不足している場合
   * @throws {Error} フォーマットが不正な場合
   *
   * @description
   * 各メディアタイプに以下のフィールドが存在することを確認:
   * - `label` (必須)
   * - `character_separator` (必須)
   */
  private validateConfig(): void {
    if (!this.config.media_type_mappings) {
      throw new Error(
        'Invalid media-type-mapping.yaml: missing "media_type_mappings" field'
      );
    }

    const requiredFields: (keyof MediaTypeMapping)[] = ['label', 'character_separator'];

    Object.entries(this.config.media_type_mappings).forEach(([mediaType, mapping]) => {
      requiredFields.forEach((field) => {
        if (!mapping[field]) {
          throw new Error(
            `Invalid media-type-mapping.yaml: ` +
              `Missing required field '${field}' for media type '${mediaType}'`
          );
        }
      });
    });
  }

  /**
   * キャラクター/メンバー名の結合セパレーターを取得
   *
   * @param mediaType - メディアタイプ（例: 'idol', 'anime'）
   * @returns セパレーター文字列（'・' または ' / '）
   *
   * @description
   * - idol/utaite → ' / '
   * - その他 → '・'
   * - 未定義のメディアタイプ → '・'（デフォルト）
   *
   * @example
   * mapper.getSeparator('idol')   // → ' / '
   * mapper.getSeparator('anime')  // → '・'
   * mapper.getSeparator('unknown') // → '・' (デフォルト)
   */
  getSeparator(mediaType: string): string {
    return this.config.media_type_mappings[mediaType]?.character_separator || '・';
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
