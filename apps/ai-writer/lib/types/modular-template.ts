/**
 * モジュール化YAMLテンプレートの型定義
 *
 * @description
 * YAMLテンプレートをモジュール化（pipeline + sections + shared）するための型定義。
 * 設計書: notes/01-project-docs/05-ai-writer/yaml-template/01-yaml-template-modularization-design.md
 *
 * @version 1.0.0
 * @created 2025-12-07
 */

// ===============================================
// 1. メタ情報（_meta.yaml）
// ===============================================

/**
 * テンプレートのメタ情報
 */
export interface TemplateMeta {
  /** テンプレートID（一意な識別子） */
  id: string;
  /** テンプレート名（表示用） */
  name: string;
  /** バージョン（セマンティックバージョニング） */
  version: string;
  /** テンプレートの説明 */
  description: string;
  /** 出力形式 */
  output_format: 'mdx' | 'html';
  /** 対象イベントタイプのリスト */
  event_types: string[];
}

/**
 * パイプライン依存関係
 */
export interface PipelineDependency {
  /** 依存するパイプラインのIDリスト */
  requires: string[];
  /** 実行条件（JavaScript式） */
  condition?: string;
}

/**
 * パイプライン定義
 */
export interface PipelineConfig {
  /** 実行順序（番号順に実行） */
  order: string[];
  /** 各パイプラインの依存関係 */
  dependencies: Record<string, PipelineDependency>;
}

/**
 * セクションスキップ条件
 */
export interface SectionSkipCondition {
  /** スキップ条件（JavaScript式） */
  skip_if: string;
}

/**
 * セクション結合定義
 */
export interface SectionsConfig {
  /** セクションの結合順序 */
  order: string[];
  /** 条件付きスキップ */
  conditional: Record<string, SectionSkipCondition>;
}

/**
 * _meta.yaml の構造
 */
export interface MetaConfig {
  /** メタ情報 */
  meta: TemplateMeta;
  /** パイプライン定義 */
  pipeline: PipelineConfig;
  /** セクション結合定義 */
  sections: SectionsConfig;
  /** 共通ファイル参照パス */
  shared: string[];
}

// ===============================================
// 2. 共通定義（shared/）
// ===============================================

/**
 * プレースホルダーのプロパティ（オブジェクト型用）
 */
export interface PlaceholderPropertyDefinition {
  type: string;
  format?: string;
  nullable?: boolean;
}

/**
 * プレースホルダー定義
 */
export interface PlaceholderDefinition {
  /** プレースホルダー名 */
  name: string;
  /** データ型 */
  type: string;
  /** 説明 */
  description?: string;
  /** フォーマット指定 */
  format?: string;
  /** 例示値 */
  example?: string | string[];
  /** オブジェクトのプロパティ定義 */
  properties?: Record<string, PlaceholderPropertyDefinition>;
  /** 配列の要素定義 */
  items?: { type: string };
  /** 抽出ヒント */
  extraction_hint?: string;
}

/**
 * shared/placeholders.yaml の構造
 */
export interface SharedPlaceholders {
  version: string;
  placeholders: {
    required: PlaceholderDefinition[];
    optional: PlaceholderDefinition[];
  };
}

/**
 * 制約定義
 */
export interface ConstraintDefinition {
  length?: {
    min?: number;
    max?: number;
    recommended?: string;
  };
  count_rule?: string;
  spacing?: {
    rule: string;
  };
  format?: string;
  heading_level?: {
    max: number;
  };
  pattern?: Record<string, string>;
}

/**
 * shared/constraints.yaml の構造
 */
export interface SharedConstraints {
  version: string;
  title: ConstraintDefinition;
  meta_description: ConstraintDefinition;
  content: ConstraintDefinition;
  date_format: {
    year: string;
    date: string;
    pattern: Record<string, string>;
  };
  url_validation: {
    pattern: string;
    official_domains: string[];
  };
}

/**
 * 共通定義のマージ結果
 */
export interface MergedShared {
  placeholders: SharedPlaceholders;
  constraints: SharedConstraints;
}

// ===============================================
// 3. パイプライン（pipeline/）
// ===============================================

/**
 * パイプライン入力定義
 */
export interface PipelineInput {
  required?: string[];
  optional?: string[];
}

/**
 * パイプライン出力定義
 */
export interface PipelineOutput {
  format: string;
  description?: string;
  schema?: string;
  structure?: string[];
}

/**
 * セクション参照設定
 */
export interface SectionsReference {
  /** セクションディレクトリ */
  source: string;
  /** 結合順序の取得元 */
  assembly_order: 'from_meta' | 'explicit';
  /** 明示的な順序（assembly_order が 'explicit' の場合） */
  order?: string[];
}

/**
 * パイプラインYAMLの構造
 */
export interface PipelineTemplate {
  template: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  input?: PipelineInput;
  output?: PipelineOutput;
  sections_reference?: SectionsReference;
  logic?: Record<string, string>;
  prompts: Record<string, string>;
  /** その他のフィールド */
  [key: string]: unknown;
}

// ===============================================
// 4. セクション（sections/）
// ===============================================

/**
 * セクション条件分岐
 */
export interface SectionCondition {
  /** 条件ID */
  id: string;
  /** 条件式 */
  condition: string;
  /** 使用するテンプレート名 */
  template: string;
}

/**
 * セクションYAMLの構造
 */
export interface SectionTemplate {
  section: {
    id: string;
    name: string;
    version: string;
    order: number;
  };
  required_placeholders?: string[];
  optional_placeholders?: string[];
  conditions?: SectionCondition[];
  templates: Record<string, string>;
  meta_description?: {
    template: string;
    max_length: number;
  };
  /** デバッグ用境界マーカー（結合時に挿入） */
  _boundary?: string;
}

/**
 * 結合済みセクション
 */
export interface MergedSections {
  /** セクションテンプレートのマップ */
  templates: Record<string, SectionTemplate>;
  /** 全セクションの条件分岐 */
  conditions: SectionCondition[];
  /** 結合順序 */
  order: string[];
}

// ===============================================
// 5. 結合済みテンプレート
// ===============================================

/**
 * 結合済みモジュラーテンプレート
 *
 * @description
 * loadModularTemplate() の戻り値として使用。
 * パイプラインを基準に、shared と sections を結合した状態。
 */
export interface MergedModularTemplate {
  /** メタ情報（_meta.yaml から） */
  _meta: MetaConfig;
  /** 共通定義（shared/ から） */
  _shared: MergedShared;
  /** セクション（sections/ から、パイプラインが参照する場合のみ） */
  _sections?: MergedSections;
  /** パイプラインテンプレート本体 */
  template: PipelineTemplate['template'];
  /** パイプライン入力定義 */
  input?: PipelineInput;
  /** パイプライン出力定義 */
  output?: PipelineOutput;
  /** ロジック定義 */
  logic?: Record<string, string>;
  /** プロンプト定義 */
  prompts: Record<string, string>;
  /** プレースホルダー定義（shared から展開） */
  placeholders?: SharedPlaceholders['placeholders'];
  /** 制約定義（shared から展開） */
  constraints?: SharedConstraints;
  /** その他のフィールド */
  [key: string]: unknown;
}

// ===============================================
// 6. ローダーオプション
// ===============================================

/**
 * モジュラーテンプレート読み込みオプション
 */
export interface LoadModularTemplateOptions {
  /** セクションを結合するかどうか（デフォルト: true） */
  includeSections?: boolean;
  /** 共通定義を結合するかどうか（デフォルト: true） */
  includeShared?: boolean;
  /** デバッグモード（境界マーカーを挿入） */
  debug?: boolean;
}
