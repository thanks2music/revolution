/**
 * Title Generation Types
 * タイトル生成用の型定義
 */

/**
 * タイトル生成リクエスト
 *
 * RSS記事情報のみを入力として、Claude AIが以下を自動抽出:
 * - 作品名
 * - 略称（存在する場合）
 * - 店舗名
 * - 開催期間.開始日
 * - 複数店舗情報（存在する場合）
 */
export interface TitleGenerationRequest {
  /** RSSアイテムのタイトル */
  rss_title: string;

  /** RSS本文（抜粋 or 全文） */
  rss_content: string;

  /** RSS記事のURL */
  rss_link: string;
}

/**
 * タイトル生成結果
 */
export interface TitleGenerationResult {
  /** 生成されたタイトル（28〜40文字） */
  title: string;

  /** タイトルの文字数 */
  length: number;

  /** 文字数制約を満たしているか */
  is_valid: boolean;
}
