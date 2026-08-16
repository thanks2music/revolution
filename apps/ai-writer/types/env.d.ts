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

    /** AI プロバイダー選択 (ベンダー名で指定: anthropic | google | openai) */
    AI_PROVIDER?: 'anthropic' | 'google' | 'openai';

    /**
     * 記事生成で使うモデル ID (API キーではない)
     *
     * `AI_PROVIDER` と対になる全プロバイダ共通の env。未設定なら各 provider の
     * 既定モデルが使われる (anthropic = Claude Sonnet 4.5 / openai = gpt-5.4-mini /
     * google = gemini-3.6-flash)。値は `AI_PROVIDER` に対応するものを入れること。
     */
    AI_MODEL?: string;

    /**
     * 記事生成の thinking の深さ (minimal | low | medium | high、既定 low)
     *
     * ⚠️ **Gemini でのみ効く。** Gemini 3.x は推論モデルで thinking トークンが
     * 出力として課金されるため、既定の medium のままだと出力コストが読めない。
     */
    AI_THINKING_LEVEL?: string;

    /** Anthropic API Key */
    ANTHROPIC_API_KEY?: string;

    /**
     * Vision 専用の Anthropic API Key (未設定なら `ANTHROPIC_API_KEY` へフォールバック)
     */
    ANTHROPIC_API_KEY_VISION?: string;

    /** Google Gemini API Key */
    GEMINI_API_KEY?: string;

    /** OpenAI API Key */
    OPENAI_API_KEY?: string;

    // ========================================
    // Vision API
    // ========================================

    /** Vision API プロバイダー選択 (ベンダー名で指定、既定 openai) */
    VISION_API_PROVIDER?: 'anthropic' | 'google' | 'openai';

    /**
     * Vision で使うモデル ID (API キーではない)
     *
     * 未設定なら各 Vision service の既定モデルが使われる
     * (openai = gpt-4o-mini / anthropic = claude-sonnet-4-5 / google = gemini-3.6-flash)。
     */
    VISION_API_MODEL?: string;

    /**
     * Vision の解像度 (low | high、既定 low)
     *
     * ⚠️ **OpenAI でのみ効く。** Gemini は `VISION_API_MEDIA_RESOLUTION`、
     * Claude には相当する概念がない。
     */
    VISION_API_DETAIL?: 'low' | 'high' | 'auto';

    /**
     * Vision の画像解像度 (low | medium | high、既定 low)
     *
     * ⚠️ **Gemini でのみ効く。** 未指定時の Gemini 側の既定は high 相当で、
     * 画像 1 枚あたり 1,083 入力トークンかかる (low なら 252 / medium なら 520)。
     * メニュー画像の文字読み取り精度が不足する場合のみ引き上げる。
     */
    VISION_API_MEDIA_RESOLUTION?: string;

    /**
     * Vision の thinking の深さ (minimal | low | medium | high、既定 low)
     *
     * ⚠️ **Gemini でのみ効く。** 生成側とは独立に指定できる。
     */
    VISION_API_THINKING_LEVEL?: string;

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

    /** 選別プロンプトデバッグモード（article-selection step: 公式URL検出） */
    DEBUG_SELECTION_PROMPT?: string;

    /** 情報抽出プロンプトデバッグモード（detail-extraction step: 作品名・店舗名・開催期間） */
    DEBUG_EXTRACTION_PROMPT?: string;

    /** タイトルプロンプトデバッグモード（title-generation step: タイトル生成 + _reasoning） */
    DEBUG_TITLE_PROMPT?: string;

    /** 本文生成プロンプトデバッグモード（content-generation step: MDX本文生成） */
    DEBUG_CONTENT_PROMPT?: string;
  }
}
