/**
 * 環境変数の型定義
 *
 * .env.local および .env.sample に対応する型定義です。
 * TypeScript の型安全性を確保し、IDE の補完を有効にします。
 */

declare namespace NodeJS {
  interface ProcessEnv {
    // ========================================
    // AI Providers
    // ========================================

    /** AI プロバイダー選択 (anthropic | gemini | openai) */
    AI_PROVIDER?: 'anthropic' | 'gemini' | 'openai';

    /** Anthropic API Key */
    ANTHROPIC_API_KEY?: string;

    /** Google Gemini API Key */
    GEMINI_API_KEY?: string;

    /** OpenAI API Key */
    OPENAI_API_KEY?: string;

    // ========================================
    // GitHub
    // ========================================

    /** GitHub Personal Access Token */
    GITHUB_PAT?: string;

    /** GitHub リポジトリオーナー */
    GITHUB_OWNER?: string;

    /** GitHub リポジトリ名 */
    GITHUB_REPO?: string;

    // ========================================
    // Firebase
    // ========================================

    /** Firebase プロジェクト ID */
    FIREBASE_PROJECT_ID?: string;

    /** Firebase API Key */
    FIREBASE_API_KEY?: string;

    /** Firebase Auth Domain */
    FIREBASE_AUTH_DOMAIN?: string;

    /** Firebase Storage Bucket */
    FIREBASE_STORAGE_BUCKET?: string;

    /** Firebase Messaging Sender ID */
    FIREBASE_MESSAGING_SENDER_ID?: string;

    /** Firebase App ID */
    FIREBASE_APP_ID?: string;

    // ========================================
    // Cloudflare R2
    // ========================================

    /** R2 API トークン値（参照用） */
    R2_ACCESS_TOKEN?: string;

    /** R2 S3互換 アクセスキーID */
    R2_ACCESS_KEY_ID: string;

    /** R2 S3互換 シークレットアクセスキー */
    R2_SECRET_ACCESS_KEY: string;

    /** R2 S3互換 エンドポイントURL */
    R2_ENDPOINT_URL: string;

    /** R2 バケット名 */
    R2_BUCKET_NAME: string;

    /** R2 公開URL（カスタムドメイン） */
    R2_PUBLIC_URL: string;

    /** R2 公開URL（Next.js クライアント用） */
    NEXT_PUBLIC_R2_PUBLIC_URL?: string;

    /** R2 デバッグモード */
    R2_DEBUG?: string;

    // ========================================
    // Development / Debug
    // ========================================

    /** Node.js 環境 */
    NODE_ENV?: 'development' | 'production' | 'test';

    /** HTML 抽出デバッグモード */
    DEBUG_HTML_EXTRACTION?: string;

    /** 選別プロンプトデバッグモード */
    DEBUG_SELECTION_PROMPT?: string;

    /** タイトルプロンプトデバッグモード */
    DEBUG_TITLE_PROMPT?: string;
  }
}
