/**
 * Article Selection Types
 * 記事採用判定用の型定義
 */

/**
 * Token usage statistics for cost tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 記事選別リクエスト
 * collabo-cafe-selection.yaml の placeholders に対応
 */
export interface ArticleSelectionRequest {
  /** RSSアイテムのタイトル */
  rss_title: string;

  /**
   * 記事本文HTML
   * extractArticleHtml()で抽出された、記事本体のHTML
   * （<article>, <main>, .entry-content などから抽出）
   * Claude AIが内部でURLを抽出し、公式情報元URLを判定する
   */
  rss_content: string;

  /** RSS配信元ドメイン（任意） */
  site_domain?: string;

  /**
   * 入力のページ自身の URL (任意)。ページ自身が公式の特設ページであり得る入口 (CLI・登録 URL) だけで渡す。
   * ページが自分へのリンクを持たないと、選別が自分を公式に選べなかった (1 ページ構成のコラボカフェの公式ページ)
   */
  page_url?: string;
}

/**
 * 記事選別結果
 * collabo-cafe-selection.yaml の output.schema に対応
 */
export interface ArticleSelectionResult {
  /** 記事生成対象にするか */
  should_generate: boolean;

  /** ユーザーが最も参照したい公式情報元URL（1つ） */
  primary_official_url: string | null;

  /** 検出された公式情報元URLの配列 */
  official_urls: string[];

  /** 判定理由 */
  reason: string;

  /** Model used for selection */
  model?: string;

  /** Token usage statistics for cost tracking */
  usage?: TokenUsage;
}
