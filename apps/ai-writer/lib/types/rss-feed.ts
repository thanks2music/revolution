// 記事妥当性設定
export interface ValidationConfig {
  keywords: string[];              // 必須キーワード（空配列の場合はキーワードチェックをスキップ）
  keywordLogic: 'AND' | 'OR';     // キーワードのマッチロジック
  requireJapanese: boolean;        // 日本語必須フラグ
  minScore: number;               // 最低妥当性スコア（0-100）
  isEnabled: boolean;             // 妥当性チェック有効/無効
}

export interface RssFeed {
  id: string;
  url: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  lastFetchedAt?: Date;
  isActive: boolean;
  validationConfig?: ValidationConfig; // 記事妥当性設定
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface CreateRssFeedInput {
  url: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  isActive?: boolean;
  validationConfig?: ValidationConfig;
}

export interface UpdateRssFeedInput {
  url?: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  isActive?: boolean;
  validationConfig?: ValidationConfig;
}

// 妥当性設定のプリセット
export interface ValidationPreset {
  id: string;
  name: string;
  description: string;
  config: ValidationConfig;
}

// 定義済みプリセット
export const VALIDATION_PRESETS: ValidationPreset[] = [
  {
    id: 'collab-cafe',
    name: 'コラボカフェ',
    description: 'アニメ・ゲームとカフェのコラボレーション情報',
    config: {
      keywords: ['コラボカフェ', 'カフェコラボ', 'コラボ カフェ', 'カフェ コラボ'],
      keywordLogic: 'OR',
      requireJapanese: true,
      minScore: 70,
      isEnabled: true
    }
  },
  {
    id: 'tech-news',
    name: '技術ニュース',
    description: 'プログラミング・開発関連ニュース',
    config: {
      keywords: ['React', 'Next.js', 'TypeScript', 'JavaScript'],
      keywordLogic: 'OR',
      requireJapanese: false,
      minScore: 75,
      isEnabled: true
    }
  },
  {
    id: 'anime-news',
    name: 'アニメニュース',
    description: 'アニメ・マンガ関連情報',
    config: {
      keywords: ['アニメ', 'マンガ', '声優', '劇場版'],
      keywordLogic: 'OR',
      requireJapanese: true,
      minScore: 70,
      isEnabled: true
    }
  },
  {
    id: 'disabled',
    name: '妥当性チェックなし',
    description: 'すべての記事を通す（キーワードチェックを行わない）',
    config: {
      keywords: [],
      keywordLogic: 'OR',
      requireJapanese: false,
      minScore: 0,
      isEnabled: false
    }
  }
];