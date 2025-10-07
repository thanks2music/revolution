import ClaudeAPIService, { ArticleGenerationRequest, GeneratedArticle } from './claude-api.service';
import { WordPressGraphQLService, PostStatus } from './wordpress-graphql.service';
import type { RssArticleEntry } from '../types/rss-article';
import { TemplateSelectorService } from './template-selector.service';
import { PlaceholderExtractorService } from './placeholder-extractor.service';
import { TemplateRendererService } from './template-renderer.service';
import { ImageExtractorService } from './image-extractor.service';
import {
  TemplateDefinition,
  TemplateProcessingContext,
  RenderedContent,
  ExtractedData,
} from '../types/template';

// Types for the article generation pipeline
export interface ArticleGenerationConfig {
  useClaudeAPI: boolean;
  wordPressEndpoint: string;
  wordPressAuthToken?: string;
  defaultStatus: PostStatus;
  defaultAuthorId?: string;
  defaultCategoryIds?: string[];
}

export interface ArticlePublishRequest {
  article: GeneratedArticle;
  status?: PostStatus;
  authorId?: string;
  categoryIds?: string[];
  publishDate?: string;
  featuredImageUrl?: string;
}

export interface ArticlePublishResult {
  success: boolean;
  postId?: string;
  databaseId?: number;
  postUrl?: string;
  error?: string;
  article: GeneratedArticle;
  wordPressCategories?: Array<{ id: string; name: string }>;
  wordPressTags?: Array<{ id: string; name: string }>;
}

export interface RSSArticleRequest {
  rssItem: {
    title: string;
    link: string;
    description?: string;
    content?: string;
    pubDate?: string;
    categories?: string[];
  };
  generationOptions?: Partial<ArticleGenerationRequest>;
  publishOptions?: Partial<ArticlePublishRequest>;
}

export class ArticleGenerationService {
  private claudeService: ClaudeAPIService;
  private wordPressService: WordPressGraphQLService;
  private config: ArticleGenerationConfig;

  // Template-based generation services
  private templateSelector: TemplateSelectorService;
  private placeholderExtractor: PlaceholderExtractorService;
  private templateRenderer: TemplateRendererService;
  private imageExtractor: ImageExtractorService;

  constructor(config: ArticleGenerationConfig) {
    this.config = config;

    if (config.useClaudeAPI) {
      this.claudeService = new ClaudeAPIService();
    }

    this.wordPressService = new WordPressGraphQLService(
      config.wordPressEndpoint,
      config.wordPressAuthToken
    );

    // Initialize template-based services
    this.templateSelector = new TemplateSelectorService();
    this.placeholderExtractor = new PlaceholderExtractorService();
    this.templateRenderer = new TemplateRendererService();
    this.imageExtractor = new ImageExtractorService();
  }

  /**
   * Generate and publish an article from RSS item
   */
  async generateAndPublishFromRSS(request: RSSArticleRequest): Promise<ArticlePublishResult> {
    try {
      console.log(`Starting article generation from RSS: ${request.rssItem.title}`);

      // Step 1: Generate article using Claude API
      const generationRequest: ArticleGenerationRequest = {
        title: request.rssItem.title,
        sourceUrl: request.rssItem.link,
        sourceContent: request.rssItem.content || request.rssItem.description,
        keywords: request.rssItem.categories,
        ...request.generationOptions
      };

      const generatedArticle = await this.generateArticle(generationRequest);

      // Step 2: Publish to WordPress
      const publishRequest: ArticlePublishRequest = {
        article: generatedArticle,
        status: this.config.defaultStatus,
        authorId: this.config.defaultAuthorId,
        categoryIds: this.config.defaultCategoryIds,
        ...request.publishOptions
      };

      const publishResult = await this.publishToWordPress(publishRequest);

      console.log(`Article generation and publishing completed: ${publishResult.success ? 'SUCCESS' : 'FAILED'}`);

      return publishResult;

    } catch (error) {
      console.error('Failed to generate and publish article from RSS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: {} as GeneratedArticle
      };
    }
  }

  /**
   * Generate an article using Claude API
   */
  async generateArticle(request: ArticleGenerationRequest): Promise<GeneratedArticle> {
    if (!this.config.useClaudeAPI) {
      throw new Error('Claude API is disabled in configuration');
    }

    try {
      console.log('Generating article with Claude API...');
      const article = await this.claudeService.generateArticle(request);
      console.log(`Article generated successfully: ${article.metadata.wordCount} characters`);
      return article;
    } catch (error) {
      console.error('Claude API article generation failed:', error);
      throw new Error(`Article generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Publish generated article to WordPress
   */
  async publishToWordPress(request: ArticlePublishRequest): Promise<ArticlePublishResult> {
    try {
      console.log('Publishing article to WordPress...');

      // Prepare categories (convert names to IDs if needed)
      const categoryIds = await this.prepareCategoryIds(request.article.categories, request.categoryIds);

      // Prepare tags (convert names to IDs if needed)
      const tagIds = await this.prepareTagIds(request.article.tags);

      // Create post in WordPress
      const post = await this.wordPressService.createPostExtended({
        title: request.article.title,
        content: request.article.content,
        slug: request.article.slug,
        excerpt: request.article.excerpt,
        status: request.status || this.config.defaultStatus,
        authorId: request.authorId || this.config.defaultAuthorId,
        categoryIds: categoryIds,
        tagIds: tagIds,
        date: request.publishDate,
        featuredImageId: request.article.metadata?.featuredImageId?.toString()
      });

      console.log(`Article published successfully to WordPress: ID ${post.databaseId}`);

      return {
        success: true,
        postId: post.id,
        databaseId: post.databaseId,
        postUrl: post.uri,
        article: request.article,
        wordPressCategories: post.categories?.nodes || [],
        wordPressTags: post.tags?.nodes || []
      };

    } catch (error) {
      console.error('WordPress publishing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: request.article
      };
    }
  }

  /**
   * Test connections to Claude API and WordPress
   */
  async testConnections(): Promise<{
    claude: boolean;
    wordpress: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let claudeStatus = false;
    let wordpressStatus = false;

    // Test Claude API
    if (this.config.useClaudeAPI) {
      try {
        claudeStatus = await this.claudeService.testConnection();
        if (!claudeStatus) {
          errors.push('Claude API connection test failed');
        }
      } catch (error) {
        errors.push(`Claude API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      claudeStatus = true; // Not required
    }

    // Test WordPress GraphQL
    try {
      wordpressStatus = await this.wordPressService.testConnection();
      if (!wordpressStatus) {
        errors.push('WordPress GraphQL connection test failed');
      }
    } catch (error) {
      errors.push(`WordPress GraphQL error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      claude: claudeStatus,
      wordpress: wordpressStatus,
      errors
    };
  }

  /**
   * Generate and publish article from RSS entry
   */
  async generateAndPublishFromRssEntry(
    rssEntry: RssArticleEntry,
    options?: {
      publishStatus?: PostStatus;
      authorId?: string;
      categoryIds?: string[];
      customTitle?: string;
      customKeywords?: string[];
    }
  ): Promise<ArticlePublishResult> {
    try {
      console.log(`Starting article generation from RSS entry: ${rssEntry.title}`);

      if (!rssEntry.link) {
        throw new Error('RSS entry must have a valid link');
      }

      // RSS記事の情報を使って記事生成リクエストを構築
      const generationOptions: Partial<ArticleGenerationRequest> = {
        title: options?.customTitle || rssEntry.title,
        keywords: options?.customKeywords || rssEntry.categories || [],
        targetLength: 600, // 記事として適切な長さ
        tone: 'friendly',
        language: 'ja'
      };

      // Claude APIでURLから記事内容を抽出して記事生成
      const generatedArticle = await this.claudeService.generateArticleFromURL(
        rssEntry.link,
        generationOptions
      );

      // WordPress投稿オプションを準備
      const publishRequest: ArticlePublishRequest = {
        article: generatedArticle,
        status: options?.publishStatus || this.config.defaultStatus,
        authorId: options?.authorId || this.config.defaultAuthorId,
        categoryIds: options?.categoryIds || this.config.defaultCategoryIds
      };

      // WordPressに投稿
      const publishResult = await this.publishToWordPress(publishRequest);

      console.log(`RSS entry processing completed: ${publishResult.success ? 'SUCCESS' : 'FAILED'}`);

      return publishResult;

    } catch (error) {
      console.error('Failed to generate and publish from RSS entry:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        article: {} as GeneratedArticle
      };
    }
  }

  /**
   * Batch process multiple RSS entries
   */
  async batchProcessRSSEntries(
    rssEntries: RssArticleEntry[],
    options: {
      concurrency?: number;
      delayBetweenRequests?: number;
      publishStatus?: PostStatus;
      authorId?: string;
      categoryIds?: string[];
    } = {}
  ): Promise<ArticlePublishResult[]> {
    const { concurrency = 2, delayBetweenRequests = 2000 } = options;
    const results: ArticlePublishResult[] = [];

    console.log(`Starting batch processing of ${rssEntries.length} RSS entries with concurrency ${concurrency}`);

    // 処理を小さなチャンクに分割（慎重に処理）
    for (let i = 0; i < rssEntries.length; i += concurrency) {
      const chunk = rssEntries.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (rssEntry) => {
        try {
          return await this.generateAndPublishFromRssEntry(rssEntry, {
            publishStatus: options.publishStatus,
            authorId: options.authorId,
            categoryIds: options.categoryIds
          });
        } catch (error) {
          console.error(`Failed to process RSS entry: ${rssEntry.title}`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            article: {} as GeneratedArticle
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // チャンク間の遅延（APIレート制限対策）
      if (i + concurrency < rssEntries.length && delayBetweenRequests > 0) {
        console.log(`Waiting ${delayBetweenRequests}ms before processing next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Batch RSS processing completed: ${successCount}/${results.length} successful`);

    return results;
  }

  /**
   * Batch process multiple RSS items
   */
  async batchProcessRSSItems(
    rssItems: RSSArticleRequest[],
    options: {
      concurrency?: number;
      delayBetweenRequests?: number;
    } = {}
  ): Promise<ArticlePublishResult[]> {
    const { concurrency = 3, delayBetweenRequests = 1000 } = options;
    const results: ArticlePublishResult[] = [];

    console.log(`Starting batch processing of ${rssItems.length} RSS items with concurrency ${concurrency}`);

    // Process in chunks to avoid overwhelming the APIs
    for (let i = 0; i < rssItems.length; i += concurrency) {
      const chunk = rssItems.slice(i, i + concurrency);

      const chunkPromises = chunk.map(async (rssItem) => {
        try {
          return await this.generateAndPublishFromRSS(rssItem);
        } catch (error) {
          console.error(`Failed to process RSS item: ${rssItem.rssItem.title}`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            article: {} as GeneratedArticle
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);

      // Add delay between chunks
      if (i + concurrency < rssItems.length && delayBetweenRequests > 0) {
        console.log(`Waiting ${delayBetweenRequests}ms before processing next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Batch processing completed: ${successCount}/${results.length} successful`);

    return results;
  }

  /**
   * ========================================
   * TEMPLATE-BASED ARTICLE GENERATION (New)
   * ========================================
   */

  /**
   * Generate article from RSS entry using YAML template-based approach
   * This is the new Phase 1 implementation using templates
   */
  async generateArticleFromRssUsingTemplate(
    rssEntry: RssArticleEntry,
    options?: {
      validationKeywords?: string[];
      forceTemplateId?: string;
      publishStatus?: PostStatus;
      authorId?: string;
      categoryIds?: string[];
    }
  ): Promise<{
    success: boolean;
    renderedContent?: RenderedContent;
    template?: TemplateDefinition;
    context?: TemplateProcessingContext;
    publishResult?: ArticlePublishResult;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      console.log("========== テンプレートベース記事生成開始 ==========");
      console.log("RSS記事:", {
        title: rssEntry.title,
        link: rssEntry.link,
      });

      // Step 1: Select template
      console.log("\n[Step 1] テンプレート選択中...");
      let template: TemplateDefinition;

      if (options?.forceTemplateId) {
        console.log("強制テンプレートID:", options.forceTemplateId);
        template = await this.templateSelector.getTemplateById(
          options.forceTemplateId
        );
      } else {
        template = await this.templateSelector.selectTemplate({
          title: rssEntry.title,
          content: rssEntry.contentSnippet || rssEntry.title,
          url: rssEntry.link,
          validationKeywords: options?.validationKeywords,
        });
      }

      console.log("選択されたテンプレート:", {
        id: template.template.id,
        name: template.template.name,
      });

      // Step 2: Extract source content
      console.log("\n[Step 2] 情報源からコンテンツ抽出中...");
      const sourceContent = await this.extractSourceContentForTemplate(
        rssEntry.link
      );
      console.log("コンテンツ抽出完了:", {
        contentLength: sourceContent.length,
      });

      // Step 3: Extract placeholder values
      console.log("\n[Step 3] プレースホルダー抽出中...");
      const { extractedData, validationResult } =
        await this.placeholderExtractor.extractAndValidate({
          template,
          sourceUrl: rssEntry.link,
          sourceContent,
        });

      console.log("プレースホルダー抽出完了:", {
        extractedFields: Object.keys(extractedData).length,
        isValid: validationResult.is_valid,
        errors: validationResult.errors.length,
      });

      // カテゴリスラッグが存在しない場合は作品名から自動生成
      if (!extractedData["カテゴリスラッグ"] && extractedData["作品名"]) {
        extractedData["カテゴリスラッグ"] = await this.generateSlugFromTitle(
          extractedData["作品名"] as string
        );
        console.log("カテゴリスラッグを自動生成:", extractedData["カテゴリスラッグ"]);
      }

      // Validation check
      if (!validationResult.is_valid) {
        console.warn("検証エラー:", validationResult.errors);

        const hasRequiredFieldErrors = validationResult.errors.some(
          (e) => e.type === "required"
        );

        if (hasRequiredFieldErrors) {
          throw new Error(
            `必須フィールドが不足: ${validationResult.errors.map((e) => e.field).join(", ")}`
          );
        }
      }

      // Step 3.5: 画像URL抽出のフォールバック処理
      console.log("\n[Step 3.5] 画像URL抽出中...");

      if (!extractedData["画像URLs"] || extractedData["画像URLs"] === null) {
        console.log("⚠️ Claude APIで画像URLが抽出できませんでした。HTMLから直接抽出します...");

        try {
          // ソースURLのHTMLコンテンツを取得
          const htmlContent = await this.fetchHtmlContent(rssEntry.link);

          // HTMLから画像URLを抽出
          const extractedImages = await this.imageExtractor.extractImagesFromHtml(
            htmlContent,
            rssEntry.link
          );

          // 抽出した画像URLをextractedDataに設定
          extractedData["画像URLs"] = {
            "アイキャッチ画像": extractedImages.eyecatch,
            "メニュー画像": extractedImages.menu,
            "ノベルティ画像": extractedImages.novelty,
            "グッズ画像": extractedImages.goods,
          };

          console.log("✅ フォールバック処理で画像URL抽出成功:", {
            eyecatch: !!extractedImages.eyecatch,
            menu: extractedImages.menu?.length || 0,
            novelty: extractedImages.novelty?.length || 0,
            goods: extractedImages.goods?.length || 0,
          });
        } catch (error) {
          console.error("❌ 画像URL抽出のフォールバック処理も失敗:", error);
          // 画像がなくても記事生成は続行
        }
      }

      // Step 4: Render template
      console.log("\n[Step 4] テンプレートレンダリング中...");

      // デバッグ用: Claude APIを除外してシンプルなテンプレート置換のみ実行
      const USE_SIMPLE_RENDERING = false; // フェーズ2: Claude API有効化

      let renderedContent: RenderedContent;

      if (USE_SIMPLE_RENDERING) {
        console.log("[DEBUG] Using simple rendering (Claude API bypassed)");
        renderedContent = this.simpleRenderTemplate(template, extractedData);
        console.log("[DEBUG] Simple rendering succeeded");
      } else {
        console.log("[DEBUG] Using Claude API for rendering");
        renderedContent = await this.templateRenderer.renderTemplate({
          template,
          extractedData,
        });
      }

      console.log("レンダリング完了:", {
        metaDescriptionLength: renderedContent.meta_description.length,
        contentLength: renderedContent.content.length,
      });

      // Step 5: Publish to WordPress (optional)
      let publishResult: ArticlePublishResult | undefined;

      if (options?.publishStatus) {
        console.log("\n[Step 5] WordPress投稿中...");

        // Step 5.1: カテゴリ自動作成
        console.log("[Step 5.1] カテゴリ作成中...");
        let categoryId: string | undefined;

        if (extractedData["作品名"]) {
          try {
            // カテゴリスラッグが空の場合は作品名から生成
            let categorySlug = extractedData["カテゴリスラッグ"] as string;
            if (!categorySlug || categorySlug.trim() === '') {
              console.log("⚠️ カテゴリスラッグが空のため、作品名から生成します");
              categorySlug = await this.generateSlugFromTitle(extractedData["作品名"] as string);
              console.log(`✅ カテゴリスラッグ生成成功: ${categorySlug}`);
            }

            categoryId = await this.wordPressService.getOrCreateCategory(
              extractedData["作品名"] as string,
              categorySlug,
              'titles' // 親カテゴリ: 作品
            );
            console.log(`✅ カテゴリ作成/取得成功: ${extractedData["作品名"]} (ID: ${categoryId})`);
          } catch (error) {
            console.error("❌ カテゴリ作成失敗:", error);
            // カテゴリがなくても記事投稿は続行
          }
        }

        // Step 5.2: 画像アップロード
        console.log("[Step 5.2] 画像アップロード中...");
        let featuredImageId: number | undefined;
        const imageUrls = extractedData["画像URLs"] as any;

        if (imageUrls && imageUrls["アイキャッチ画像"]) {
          try {
            const media = await this.wordPressService.uploadMediaFromUrl(
              imageUrls["アイキャッチ画像"],
              `${extractedData["作品名"]} アイキャッチ`,
              `${extractedData["作品名"]} ${extractedData["イベント名"]}`
            );
            featuredImageId = media.id;
            console.log(`✅ アイキャッチ画像アップロード成功 (ID: ${media.id})`);
          } catch (error) {
            console.error("❌ アイキャッチ画像アップロード失敗:", error);
            // 画像がなくても記事投稿は続行
          }
        }

        // Step 5.3: 記事作成
        console.log("[Step 5.3] 記事作成中...");

        // Create GeneratedArticle structure from rendered content
        const generatedArticle: GeneratedArticle = {
          title: extractedData["作品名"] || rssEntry.title,
          content: renderedContent.content,
          excerpt: renderedContent.meta_description,
          slug: extractedData["カテゴリスラッグ"] as string || "untitled",
          tags: [],
          categories: categoryId ? [categoryId] : [],
          metadata: {
            sourceUrl: rssEntry.link,
            generatedAt: new Date().toISOString(),
            wordCount: renderedContent.content.length,
            model: "template-based",
            categoryId,
            featuredImageId,
          },
        };

        publishResult = await this.publishToWordPress({
          article: generatedArticle,
          status: options.publishStatus,
          authorId: options.authorId,
          categoryIds: options.categoryIds,
        });

        console.log("WordPress投稿完了:", {
          success: publishResult.success,
          postId: publishResult.postId,
        });
      }

      const processingTime = Date.now() - startTime;
      console.log(
        `\n========== テンプレートベース記事生成完了 (${processingTime}ms) ==========`
      );

      return {
        success: true,
        renderedContent,
        template,
        context: {
          template,
          extractedData,
          validationResult,
          renderedContent,
        },
        publishResult,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(
        `\n========== テンプレートベース記事生成失敗 (${processingTime}ms) ==========`
      );
      console.error("エラー:", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Extract source content for template processing
   */
  private async extractSourceContentForTemplate(url: string): Promise<string> {
    try {
      const extracted = await this.claudeService.extractContentFromURL(url);
      return `
タイトル: ${extracted.title}

${extracted.content}

${extracted.description ? `説明: ${extracted.description}` : ""}
`.trim();
    } catch (error) {
      console.warn(
        "コンテンツ抽出に失敗しました。URLのみを使用します:",
        error
      );
      return `URL: ${url}`;
    }
  }

  /**
   * Fetch HTML content from URL
   * @param url URL to fetch
   * @returns HTML content
   */
  private async fetchHtmlContent(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch HTML: ${response.statusText}`);
      }
      const html = await response.text();
      return html;
    } catch (error) {
      console.error("Failed to fetch HTML content:", error);
      throw error;
    }
  }

  /**
   * Generate URL-friendly slug from title using Claude API
   * Claude APIが日本語タイトルをローマ字スラッグに変換
   */
  private async generateSlugFromTitle(title: string): Promise<string> {
    try {
      console.log(`カテゴリスラッグ生成を開始: ${title}`);

      // Claude APIでスラッグ変換を依頼
      const slug = await this.claudeService.generateSlug(title);
      console.log(`✅ Claude APIでスラッグ生成成功: ${title} → ${slug}`);

      return slug;
    } catch (error) {
      console.error(`❌ Claude APIでスラッグ生成失敗: ${title}`, error);

      // フォールバック: 英数字以外を削除して小文字化
      const fallbackSlug = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      console.log(`⚠️ フォールバックスラッグ使用: ${fallbackSlug || "(empty)"}`);
      return fallbackSlug || "untitled";
    }
  }

  /**
   * Simple template rendering without Claude API (for debugging)
   * Claude APIを使わずシンプルな置換のみでテンプレートをレンダリング
   */
  private simpleRenderTemplate(
    template: TemplateDefinition,
    extractedData: ExtractedData
  ): RenderedContent {
    // Meta description: 条件分岐でテンプレート選択
    const metaTemplateKey =
      this.templateRenderer.selectTemplateByCondition(
        template,
        "meta_description",
        extractedData
      ) || "meta_description_generic";

    const metaDescription = this.templateRenderer["simpleReplace"](
      template.templates[metaTemplateKey],
      extractedData
    );

    // Lead text: 条件分岐でテンプレート選択
    const leadTemplateKey =
      this.templateRenderer.selectTemplateByCondition(
        template,
        "lead_text",
        extractedData
      ) || "lead_generic";

    const leadText = this.templateRenderer["simpleReplace"](
      template.templates[leadTemplateKey] || "",
      extractedData
    );

    // Main content
    const mainContent = this.templateRenderer["simpleReplace"](
      template.templates.main_content || "",
      extractedData
    );

    // Content: リード文 + メインコンテンツ
    const content = [leadText, mainContent].filter(Boolean).join("\n\n");

    return {
      meta_description: metaDescription.substring(0, 160), // 160文字制限
      content,
    };
  }

  /**
   * ========================================
   * HELPER METHODS
   * ========================================
   */

  /**
   * Convert category names to IDs (implement based on WordPress API)
   */
  private async prepareCategoryIds(categoryNames: string[], existingIds?: string[]): Promise<string[] | undefined> {
    // If explicit IDs are provided, use them
    if (existingIds && existingIds.length > 0) {
      return existingIds;
    }

    // If no categories, return undefined
    if (!categoryNames || categoryNames.length === 0) {
      return undefined;
    }

    // Check if categoryNames are already WordPress GraphQL IDs (base64-encoded, e.g., "dGVybTo4")
    const isAlreadyIds = categoryNames.every(cat =>
      typeof cat === 'string' && /^[A-Za-z0-9+/=]+$/.test(cat) && cat.length > 5
    );

    if (isAlreadyIds) {
      console.log('Categories are already IDs, using them directly:', categoryNames);
      return categoryNames;
    }

    // TODO: Implement category name to ID conversion
    // For now, return undefined and let WordPress handle it
    console.log('Category name to ID conversion not implemented yet, categories:', categoryNames);
    return undefined;
  }

  /**
   * Convert tag names to IDs (implement based on WordPress API)
   */
  private async prepareTagIds(tagNames: string[]): Promise<string[] | undefined> {
    // If no tags, return undefined
    if (!tagNames || tagNames.length === 0) {
      return undefined;
    }

    // TODO: Implement tag name to ID conversion
    // For now, return undefined and let WordPress handle it
    console.log('Tag name to ID conversion not implemented yet, tags:', tagNames);
    return undefined;
  }
}

export default ArticleGenerationService;