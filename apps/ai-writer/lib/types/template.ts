/**
 * テンプレートベースの記事生成システムの型定義
 * YAML形式のテンプレートをTypeScriptで扱うための型を定義
 */

// ===============================================
// 1. テンプレートメタデータ
// ===============================================

/**
 * テンプレートの基本情報
 */
export interface TemplateMetadata {
  /** テンプレートID（一意な識別子） */
  id: string;
  /** テンプレート名（表示用） */
  name: string;
  /** バージョン（セマンティックバージョニング） */
  version: string;
  /** テンプレートの説明 */
  description?: string;
  /** このテンプレートが対応するイベントタイプのリスト */
  eventTypes: string[];
}

// ===============================================
// 2. プレースホルダー定義
// ===============================================

/**
 * プレースホルダーの基本型
 */
export type PlaceholderType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

/**
 * オブジェクト型プレースホルダーのプロパティ定義
 */
export interface PlaceholderProperty {
  type: PlaceholderType;
  format?: string;
  example?: any;
}

/**
 * プレースホルダーの定義
 */
export interface Placeholder {
  /** プレースホルダー名 */
  name: string;
  /** データ型 */
  type: PlaceholderType;
  /** フォーマット指定（date, url など） */
  format?: string;
  /** 例示値 */
  example?: any;
  /** プロパティ定義（object型の場合） */
  properties?: Record<string, PlaceholderProperty>;
  /** 配列の要素型定義（array型の場合） */
  items?: PlaceholderProperty;
  /** デフォルト値 */
  default?: any;
  /** 情報抽出のヒント（Claude APIへの指示） */
  extraction_hint?: string;
}

/**
 * プレースホルダーのセット
 */
export interface Placeholders {
  /** 必須プレースホルダー */
  required: Placeholder[];
  /** オプションプレースホルダー */
  optional: Placeholder[];
}

// ===============================================
// 3. 条件分岐定義
// ===============================================

/**
 * 条件分岐のルール
 */
export interface ConditionRule {
  /** 条件式（例: "キャラクター名 が存在する"） */
  condition: string;
  /** 使用するテンプレート名 */
  use_template: string;
}

/**
 * 条件分岐の定義
 */
export interface Conditions {
  /** メタディスクリプション用の条件 */
  meta_description?: ConditionRule[];
  /** その他のカスタム条件 */
  [key: string]: ConditionRule[] | undefined;
}

// ===============================================
// 4. テンプレート本文
// ===============================================

/**
 * テンプレート本文の定義
 */
export interface Templates {
  /** メインコンテンツテンプレート */
  main_content: string;
  /** その他のカスタムテンプレート */
  [key: string]: string;
}

// ===============================================
// 5. Claude APIプロンプト指示
// ===============================================

/**
 * Claude APIへのプロンプト指示
 */
export interface PromptInstructions {
  /** 情報抽出時の指示 */
  extraction_instruction: string;
  /** テンプレートレンダリング時の指示 */
  rendering_instruction: string;
  /** テンプレート選択時の指示 */
  selection_instruction: string;
}

// ===============================================
// 6. 検証ルール
// ===============================================

/**
 * フィールドのフォーマット検証ルール
 */
export interface FormatRule {
  /** 検証対象フィールド */
  field: string;
  /** 正規表現パターン */
  pattern: string;
  /** エラーメッセージ */
  error_message: string;
}

/**
 * 検証ルールの定義
 */
export interface ValidationRules {
  /** 必須フィールドのリスト */
  required_fields: string[];
  /** フォーマット検証ルール */
  format_rules: FormatRule[];
}

// ===============================================
// 7. 使用例・サンプルデータ
// ===============================================

/**
 * テンプレート使用例
 */
export interface TemplateExample {
  /** 例の説明 */
  description: string;
  /** 入力データ */
  input: Record<string, any>;
  /** 期待されるメタディスクリプション */
  expected_meta_description?: string;
}

// ===============================================
// 8. メインテンプレート定義
// ===============================================

/**
 * YAMLテンプレート全体の構造
 */
export interface TemplateDefinition {
  /** テンプレートメタデータ */
  template: TemplateMetadata;
  /** プレースホルダー定義 */
  placeholders: Placeholders;
  /** 条件分岐定義 */
  conditions: Conditions;
  /** テンプレート本文 */
  templates: Templates;
  /** Claude APIプロンプト指示 */
  prompts: PromptInstructions;
  /** 検証ルール */
  validation: ValidationRules;
  /** 使用例（オプション） */
  examples?: TemplateExample[];
}

// ===============================================
// 9. テンプレート選択結果
// ===============================================

/**
 * テンプレート選択の判定結果
 */
export interface TemplateSelectionResult {
  /** 適用可能かどうか */
  is_applicable: boolean;
  /** 信頼度（0.0 ~ 1.0） */
  confidence: number;
  /** 判定理由 */
  reason: string;
  /** マッチしたキーワード */
  matched_keywords: string[];
  /** フォールバックテンプレートかどうか */
  is_fallback?: boolean;
}

// ===============================================
// 10. 情報抽出結果
// ===============================================

/**
 * Claude APIによる情報抽出結果
 */
export interface ExtractedData {
  /** 抽出されたデータ（プレースホルダー名をキーとする） */
  [key: string]: any;
}

// ===============================================
// 11. レンダリング結果
// ===============================================

/**
 * テンプレートのレンダリング結果
 */
export interface RenderedContent {
  /** メタディスクリプション */
  meta_description: string;
  /** 記事本文（HTML） */
  content: string;
}

// ===============================================
// 12. 検証結果
// ===============================================

/**
 * 検証エラーの詳細
 */
export interface ValidationError {
  /** エラーが発生したフィールド */
  field: string;
  /** エラーメッセージ */
  message: string;
  /** エラーの種類 */
  type: "required" | "format" | "type";
}

/**
 * 検証結果
 */
export interface ValidationResult {
  /** 検証が成功したかどうか */
  is_valid: boolean;
  /** エラーのリスト */
  errors: ValidationError[];
}

// ===============================================
// 13. テンプレート処理のコンテキスト
// ===============================================

/**
 * テンプレート処理全体のコンテキスト
 */
export interface TemplateProcessingContext {
  /** 選択されたテンプレート */
  template: TemplateDefinition;
  /** 抽出されたデータ */
  extractedData: ExtractedData;
  /** 検証結果 */
  validationResult: ValidationResult;
  /** レンダリング結果 */
  renderedContent?: RenderedContent;
}

// ===============================================
// 14. サービス間のデータ転送オブジェクト
// ===============================================

/**
 * テンプレート選択リクエスト
 */
export interface TemplateSelectionRequest {
  /** RSS記事のタイトル */
  title: string;
  /** RSS記事の本文 */
  content: string;
  /** RSS記事のURL */
  url: string;
  /** フィードのvalidationConfig（キーワードを含む） */
  validationKeywords?: string[];
}

/**
 * 情報抽出リクエスト
 */
export interface ExtractionRequest {
  /** テンプレート定義 */
  template: TemplateDefinition;
  /** 情報元URL */
  sourceUrl: string;
  /** 抽出対象のコンテンツ（HTMLまたはテキスト） */
  sourceContent: string;
}

/**
 * テンプレートレンダリングリクエスト
 */
export interface RenderingRequest {
  /** テンプレート定義 */
  template: TemplateDefinition;
  /** 抽出されたデータ */
  extractedData: ExtractedData;
}
