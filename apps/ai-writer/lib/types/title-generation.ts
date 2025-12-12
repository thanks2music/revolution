/**
 * Title Generation Types
 * タイトル生成用の型定義
 */

/**
 * 開催期間（ExtractionService からインポートせず独自定義）
 * タイトル生成で使用する開催期間情報
 */
export interface TitleEventPeriod {
  /** 開始日情報 */
  開始: {
    /** 年（YYYY年形式） */
    年: string;
    /** 日付（N月NN日形式） */
    日付: string;
  };
  /** 終了日情報 */
  終了: {
    /** 年（YYYY年形式、未定の場合はnull） */
    年: string | null;
    /** 日付（N月NN日形式、未定の場合はnull） */
    日付: string | null;
    /** 終了日が未定の場合はtrue */
    未定: boolean;
  };
}

/**
 * タイトル生成リクエスト
 *
 * RSS記事情報と抽出済み開催期間を入力として、Claude AIが以下を自動抽出:
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

  /**
   * Step 1.5 で抽出済みの開催期間（オプション）
   * 指定された場合、AIはこの日付を優先して使用する
   */
  extractedPeriod?: TitleEventPeriod;

  /**
   * Step 1.5 で抽出済みの店舗名（オプション）
   */
  extractedStoreName?: string;

  /**
   * Step 1.5 で抽出済みの作品名（オプション）
   */
  extractedWorkName?: string;
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

  /**
   * タイトル生成の判断理由（デバッグ用）
   * なぜこのタイトルにしたか、どのルールを適用したかを説明
   */
  _reasoning?: string;
}
