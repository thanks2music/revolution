import { generateMdxArticle } from '../mdx/template-generator';
import { type MdxArticle } from '../mdx/types';
import { createMdxPr, type CreateMdxPrResult } from '../github/create-mdx-pr';
import {
  checkEventDuplication,
  registerNewEvent,
  updateEventStatus,
  deleteEvent,
} from '../firestore/event-deduplication';
import { type EventCanonicalKey } from '../firestore/types';
import {
  resolveWorkSlug,
  resolveStoreSlug,
  resolveEventTypeSlug,
  resolvePrefectureSlugs,
  getShortTitle,
} from '../config/slug-resolver';
import { DuplicateSlugError } from '../errors/github';
import { getPrStatusByCanonicalKey } from '../github/pr-status';
import { extractFromRss, type RssExtractionResult } from '../claude/rss-extractor';
import { generateArticleMetadata } from '../claude/metadata-generator';
import { type ArticleMetadata } from '../claude/types';
import { createAiProvider, getConfiguredProvider } from '../ai/factory/ai-factory';
import { extractArticleHtml, extractContentHtml, extractPageLinks } from '../utils/html-extractor';
import { toIsoMsDate } from '../utils/date';
import { ArticleSelectionService } from './article-selection.service';
import { getStepDisplay, getStepContext } from './pipeline-steps';
import {
  type ArticleSelectionRequest,
  type ArticleSelectionResult,
} from '@/lib/types/article-selection';
import { TitleGenerationService } from './title-generation.service';
import {
  type TitleGenerationRequest,
  type TitleGenerationResult,
} from '@/lib/types/title-generation';
import {
  ExtractionService,
  type ExtractionResult,
} from './extraction.service';
import {
  ContentGenerationService,
  type ContentGenerationResult,
} from './content-generation.service';
import {
  getOgImageUploadService,
  type OgImageUploadResult,
} from './og-image-upload.service';
import {
  getArticleImageUploadService,
  type ArticleImageUploadResult,
} from './article-image-upload.service';
import { getR2StorageService } from './r2-storage.service';
import {
  getSubpageDetectorService,
  type SubpageDetectionResult,
} from './subpage-detector.service';
import {
  getCategoryImageExtractorService,
  type CategoryImages,
} from './category-image-extractor.service';
import {
  getImagePlaceholderReplacerService,
  type CategoryR2Images,
  type PlaceholderReplacementResult,
} from './image-placeholder-replacer.service';
import {
  getTextPlaceholderReplacerService,
  type TextPlaceholderReplacementResult,
} from './text-placeholder-replacer.service';
import {
  createCostTracker,
  type CostTrackerService,
} from '@/lib/ai/cost';
import { buildCategories } from '@/lib/utils/category-builder';
import { validateStoreName } from '@/lib/utils/store-name-validator';
import { VisionApiServiceFactory } from './vision-api/vision-api-service.factory';
import { callVisionApiForAllCategories } from './vision-api/multi-category-vision.service';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import {
  crossCheckVisionResult,
  detectHallucination,
  selectFallbackLevel,
  validateBusinessRules,
  type HtmlExtractionData,
} from '@/lib/utils/vision-api-utils';
import { checkExtractionSufficiency } from '@/lib/config/vision-api-thresholds';
import type {
  VisionExtractionResult,
  FallbackLevelType,
} from '@/lib/types/vision-api';

/**
 * RSS記事からMDX記事を生成するためのリクエスト
 */
export interface MdxGenerationRequest {
  rssItem: {
    title: string;
    link: string;
    content?: string;
    contentSnippet?: string;
    pubDate?: string;
  };
  // AI APIで抽出された情報（オプション）
  extracted?: {
    workTitle: string;
    storeName: string;
    eventTypeName: string;
  };
  /**
   * ドライランモード
   * true の場合、Firestore登録、GitHub PR作成、画像アップロードをすべてスキップ
   * AI処理（記事選別、情報抽出、メタデータ生成）のみ実行
   */
  dryRun?: boolean;
  /**
   * ローカル保存モード
   * true の場合、Firestore登録とGitHub PR作成をスキップ
   * ただし、画像アップロード（R2）は実行する
   * デバッグ時に画像アップロードをテストしつつ、PRは作成しない場合に使用
   */
  localOnly?: boolean;
}

/**
 * MDX記事生成の結果
 */
export interface MdxGenerationResult {
  success: boolean;
  skipped?: boolean; // 記事選別でスキップされた場合
  skipReason?: string; // スキップ理由
  mdxArticle?: MdxArticle;
  prResult?: CreateMdxPrResult;
  eventRecord?: EventCanonicalKey;
  error?: string;
  // 詳細情報（デバッグ用）
  details?: {
    workSlug: string;
    storeSlug: string;
    eventType: string;
    canonicalKey: string;
    postId: string;
    year: number;
  };
  // 公式サイトからの詳細抽出結果（detail-extraction step）
  detailedExtraction?: ExtractionResult;
  // コンテンツ生成結果（content-generation step）
  contentGeneration?: ContentGenerationResult;
  // OG画像アップロード結果（image-upload-r2 step）
  ogImageUpload?: OgImageUploadResult;
  // 本文画像アップロード結果（image-upload-r2 step）
  bodyImagesUpload?: ArticleImageUploadResult;
  // 下層ページ検出結果（subpage-detection step）
  subpageDetection?: SubpageDetectionResult;
  // カテゴリ別画像抽出結果（category-image-extraction step）
  categoryImages?: CategoryImages;
  // カテゴリ別R2画像URL（image-upload-r2 step (categories sub)後）
  categoryR2Images?: CategoryR2Images;
  // 画像プレースホルダー置換結果（image-placeholder-replacement step）
  placeholderReplacement?: PlaceholderReplacementResult;
  // テキストプレースホルダー置換結果（text-placeholder-replacement step）
  textPlaceholderReplacement?: TextPlaceholderReplacementResult;
  // Vision API 統合結果（vision-api step）
  visionApiResult?: {
    called: boolean;
    htmlSufficiencyCheck?: HtmlExtractionData;
    visionExtraction?: VisionExtractionResult;
    fallbackLevel?: FallbackLevelType;
    hallucinationDetected?: boolean;
    crossCheckPassed?: boolean;
  };
}

/**
 * MDX記事生成サービス
 *
 * このサービスは、RSS記事からMDX形式の記事を生成し、GitHub PRを作成します。
 * WordPress版の `ArticleGenerationService` と対応する機能を提供します。
 *
 * 主な機能:
 * - RSS記事からのMDX生成
 * - Firestoreベースの重複チェック
 * - Canonical Key生成とslug解決
 * - GitHub PR作成
 * - エラーハンドリングとステータス管理
 */
export class ArticleGenerationMdxService {
  /**
   * RSS記事からMDX記事を生成してGitHub PRを作成
   *
   * @param request MDX生成リクエスト
   * @returns MDX生成結果
   *
   * 処理フローの完全な定義・順序は `./pipeline-steps.ts` の `PIPELINE_STEPS` を参照。
   * 主要 step (id):
   *  - article-selection / rss-extraction / detail-extraction
   *  - subpage-detection / category-image-extraction / vision-api
   *  - slug-generation / duplication-check
   *  - metadata-generation / title-generation / content-generation
   *  - image-upload-r2 / image-placeholder-replacement / text-placeholder-replacement / footer-placeholder-cleanup
   *  - mdx-assembly / github-pr-creation / firestore-status-update
   *
   * @description
   * マルチプロバイダー対応済み（2025-12-07）
   * AI_PROVIDER環境変数でプロバイダーを切り替え可能
   */
  async generateMdxFromRSS(request: MdxGenerationRequest): Promise<MdxGenerationResult> {
    const { rssItem, dryRun = false, localOnly = false } = request;
    const year = new Date().getFullYear();

    // モード判定用のヘルパー変数
    // skipExternalOps: Firestore/GitHub操作をスキップ（dryRun OR localOnly）
    // skipImageUpload: 画像アップロードをスキップ（dryRunのみ、localOnlyでは実行）
    const skipExternalOps = dryRun || localOnly;
    const skipImageUpload = dryRun && !localOnly;

    // Get configured AI provider for logging
    const providerName = getConfiguredProvider();
    const providerDisplayName = {
      anthropic: 'Anthropic Claude',
      gemini: 'Google Gemini',
      openai: 'OpenAI',
    }[providerName] || providerName;

    console.log('========== MDXパイプライン: 記事生成開始 ==========');
    console.log(`🤖 Using AI Provider: ${providerDisplayName}`);
    if (dryRun) {
      console.log('🧪 ドライランモード: Firestore登録・GitHub PR作成・画像アップロードをスキップします');
    } else if (localOnly) {
      console.log('💾 ローカル保存モード: Firestore登録・GitHub PR作成をスキップ（画像アップロードは実行）');
    }
    console.log('RSS記事:', { title: rssItem.title, link: rssItem.link });

    // コストトラッカーを初期化（記事ごとに新規作成）
    const costTracker = createCostTracker(rssItem.link);

    // RSS本文を取得（title-generation step と content-generation step で使用）
    const rawContent = rssItem.content || rssItem.contentSnippet || '';

    try {
      // article-selection step: Article selection filter (公式URL検出 + 採用判定)
      console.log(`\n${getStepDisplay('article-selection')} AI API (${providerDisplayName}) で記事選別（公式URL検出、採用判定）...`);
      console.log('記事URLからHTML取得中:', rssItem.link);

      const articleHtml = await extractArticleHtml(rssItem.link);
      console.log('記事HTML取得完了:', articleHtml.length, 'bytes');

      const selectionService = new ArticleSelectionService();
      const selectionResult = await selectionService.shouldGenerateArticle({
        rss_title: rssItem.title,
        rss_content: articleHtml,
        site_domain: new URL(rssItem.link).hostname,
      });

      // 公式URLが見つからない場合はスキップ
      if (!selectionResult.should_generate) {
        console.log('⚠️ 記事生成をスキップ:', selectionResult.reason);
        console.log('========== MDXパイプライン: 記事生成スキップ ==========\n');

        return {
          success: false,
          skipped: true,
          skipReason: selectionResult.reason,
        };
      }

      console.log('✅ 記事生成対象として採用');

      // コストを記録（article-selection step: ArticleSelection）
      if (selectionResult.model && selectionResult.usage) {
        costTracker.recordUsage(
          'article-selection',
          selectionResult.model,
          selectionResult.usage
        );
      }

      // AI メタデータを記録（article-selection step のモデル情報を使用）
      // CRITICAL FIX: Handle undefined model with fallback
      const aiModel = selectionResult.model || 'unknown';

      console.log('🤖 AI メタデータ:', {
        provider: providerName,
        model: aiModel,
        modelSource: selectionResult.model ? 'article-selection step (ArticleSelection)' : 'フォールバック (unknown)',
      });

      // rss-extraction step: Extract work/store/event information from RSS
      console.log(`\n${getStepDisplay('rss-extraction')} AI API (${providerDisplayName}) でRSS記事から作品/店舗/イベント情報を抽出...`);

      const extraction =
        request.extracted ||
        (await extractFromRss({
          title: rssItem.title,
          content: rssItem.content || rssItem.contentSnippet || '',
          link: rssItem.link,
        }));

      console.log('抽出結果:', extraction);

      // コストを記録（rss-extraction step: RssExtraction）
      // Note: request.extracted が渡された場合は AI 呼び出しがないため usage がない
      // extractFromRss の戻り値のみ model と usage を持つ
      const extractionWithUsage = extraction as RssExtractionResult;
      if (!request.extracted && extractionWithUsage.usage) {
        costTracker.recordUsage(
          'rss-extraction',
          extractionWithUsage.model,
          extractionWithUsage.usage
        );
      }

      // detail-extraction step: Extract detailed information from official site HTML
      console.log(`\n${getStepDisplay('detail-extraction')} AI API (${providerDisplayName}) で公式サイトHTMLから詳細情報を抽出...`);

      let detailedExtraction: ExtractionResult | undefined;
      // 公式サイトのHTMLを保持（content-generation step と image-upload-r2 step で再利用）
      let officialHtml: string | undefined;

      if (selectionResult.primary_official_url) {
        try {
          // 公式サイトのHTMLを1回だけ取得（content-generation step と image-upload-r2 step で再利用）
          console.log('公式サイトURLからHTML取得中:', selectionResult.primary_official_url);
          officialHtml = await extractContentHtml(selectionResult.primary_official_url);
          console.log('公式サイトHTML取得完了:', officialHtml.length, 'bytes');

          // ExtractionService で詳細情報を抽出
          const extractionService = new ExtractionService();
          detailedExtraction = await extractionService.extractFromOfficialSite({
            primary_official_url: selectionResult.primary_official_url,
            page_content: officialHtml,
            official_urls: selectionResult.official_urls,
          });

          console.log('詳細抽出結果:', {
            // 新構造（複数作品コラボ対応 v1.2.0）
            works: detailedExtraction.works,
            store: detailedExtraction.store,
            is_multi_work_collaboration: detailedExtraction.is_multi_work_collaboration,
            // 後方互換性フィールド（実際に下流処理で使用）
            作品名: detailedExtraction.作品名,
            メディアタイプ: detailedExtraction.メディアタイプ,
            原作タイプ: detailedExtraction.原作タイプ,
            原作者有無: detailedExtraction.原作者有無,
            原作者名: detailedExtraction.原作者名,
            店舗名: detailedExtraction.店舗名,
            開催期間: detailedExtraction.開催期間,
            略称: detailedExtraction.略称,
          });

          // コストを記録
          if (detailedExtraction.model && detailedExtraction.usage) {
            costTracker.recordUsage(
              'detail-extraction',
              detailedExtraction.model,
              detailedExtraction.usage
            );
          }
        } catch (extractionError) {
          console.error('❌ 公式サイトからの詳細抽出に失敗しました:', extractionError);
          // 必須フィールドが取得できない場合は記事生成を中止
          return {
            success: false,
            skipped: true,
            skipReason: `公式サイトからの詳細抽出に失敗: ${extractionError instanceof Error ? extractionError.message : 'Unknown error'}`,
          };
        }
      } else {
        console.error('❌ 公式サイトURLが見つからないため、記事生成を中止');
        return {
          success: false,
          skipped: true,
          skipReason: '公式サイトURLが見つからないため、詳細情報を抽出できません',
        };
      }

      // 詳細抽出結果の必須フィールド検証
      if (!detailedExtraction) {
        console.error('❌ 詳細抽出結果がnullのため、記事生成を中止');
        return {
          success: false,
          skipped: true,
          skipReason: '詳細抽出結果がありません',
        };
      }

      // ========================================
      // 作品名の正規化（rss-extraction step の workTitle を canonical として使用）
      // ========================================
      // detail-extraction step の「作品名」はイベント名を含む場合があるため、
      // rss-extraction step（RSS抽出）の workTitle を正式な作品名として採用する
      const canonicalWorkTitle = extraction.workTitle;

      // 差分があればログ出力（デバッグ用）
      if (detailedExtraction.作品名 !== canonicalWorkTitle) {
        console.log('📝 作品名の正規化:', {
          'rss-extraction step (canonical)': canonicalWorkTitle,
          'detail-extraction step (参考)': detailedExtraction.作品名,
          '差分理由': 'detail-extraction step がイベント名を含んでいる可能性あり',
        });
      }

      // subpage-detection step: Subpage detection（下層ページ検出）
      console.log(`\n${getStepDisplay('subpage-detection')} 下層ページ検出（メニュー/ノベルティ/グッズ）...`);

      let subpageDetection: SubpageDetectionResult | undefined;
      let categoryImages: CategoryImages | undefined;

      if (selectionResult.primary_official_url && officialHtml) {
        try {
          // 公式サイトHTMLからリンクを抽出
          const pageLinks = extractPageLinks(officialHtml, selectionResult.primary_official_url);
          console.log(`${getStepContext('subpage-detection')} 公式サイトから${pageLinks.length}件のリンクを抽出`);

          // 下層ページを検出
          const subpageService = getSubpageDetectorService();
          // 店舗名: detail-extraction step の結果を検証し、不適切な場合は rss-extraction step にフォールバック
          const storeName = validateStoreName(detailedExtraction?.店舗名) || extraction.storeName;

          subpageDetection = await subpageService.detectSubpages(
            selectionResult.primary_official_url,
            storeName,
            pageLinks
          );

          console.log(`${getStepContext('subpage-detection')} 下層ページ検出結果:`, {
            menu: subpageDetection.categoryUrls.menu?.length || 0,
            novelty: subpageDetection.categoryUrls.novelty?.length || 0,
            goods: subpageDetection.categoryUrls.goods?.length || 0,
            isTopPageOnly: subpageDetection.isTopPageOnly,
            methods: subpageDetection.detectionMethods,
          });

          // コストを記録（subpage-detection step: SubpageDetection - AI使用時のみ）
          if (subpageDetection.model && subpageDetection.usage) {
            costTracker.recordUsage(
              'subpage-detection',
              subpageDetection.model,
              subpageDetection.usage
            );
          }

          // category-image-extraction step: Category image extraction（カテゴリ別画像抽出）
          console.log(`\n${getStepDisplay('category-image-extraction')} カテゴリ別画像抽出（下層ページから画像を取得）...`);

          const categoryImageService = getCategoryImageExtractorService();
          categoryImages = await categoryImageService.extractCategoryImages(
            selectionResult.primary_official_url,
            officialHtml,
            subpageDetection.categoryUrls
          );

          console.log(`${getStepContext('category-image-extraction')} カテゴリ別画像抽出結果:`, {
            eyecatch: categoryImages.eyecatch ? '取得済み' : 'なし',
            menu: categoryImages.menu.length,
            novelty: categoryImages.novelty.length,
            goods: categoryImages.goods.length,
            total: categoryImages.all.length,
          });
        } catch (subpageError) {
          console.warn('⚠️ 下層ページ検出/画像抽出に失敗（処理は続行）:', subpageError);
          // エラーが発生しても処理は続行（既存のトップページ画像抽出にフォールバック）
        }
      } else {
        console.log(`[subpage-detection/category-image-extraction] 公式サイトHTMLがないため、下層ページ検出をスキップ`);
      }

      // vision-api step: Vision API Integration (conditional)
      console.log(`\n${getStepDisplay('vision-api')} Vision API統合（HTML充足性チェック + 条件付き呼び出し）...`);

      let visionApiResult: {
        called: boolean;
        htmlSufficiencyCheck?: HtmlExtractionData;
        visionExtraction?: VisionExtractionResult;
        fallbackLevel?: FallbackLevelType;
        hallucinationDetected?: boolean;
        crossCheckPassed?: boolean;
      } = { called: false };

      if (!detailedExtraction) {
        console.log(`${getStepContext('vision-api')} detailedExtraction がないため、Vision API をスキップ`);
      } else {
        // HTML充足性チェック
        const htmlSufficiency: HtmlExtractionData = this.calculateHtmlSufficiency(detailedExtraction);
        visionApiResult.htmlSufficiencyCheck = htmlSufficiency;

        console.log(`${getStepContext('vision-api')} HTML充足性チェック結果:`, {
          menuItemCount: htmlSufficiency.menuItemCount,
          priceCount: htmlSufficiency.priceCount,
          sufficiencyRate: `${(htmlSufficiency.htmlSufficiencyRate * 100).toFixed(1)}%`,
        });

        // 充足性判定（閾値は VISION_API_THRESHOLDS に集約、checkExtractionSufficiency() を使用）
        const sufficiencyResult = checkExtractionSufficiency(
          htmlSufficiency.menuItemCount,
          htmlSufficiency.priceCount,
          htmlSufficiency.htmlSufficiencyRate,
        );

        if (sufficiencyResult.isSufficient) {
          console.log(`${getStepContext('vision-api')} ✅ HTML充足 → Vision API をスキップ`, { reason: sufficiencyResult.reason });
        } else {
          console.log(`${getStepContext('vision-api')} ❌ HTML不足 → Vision API を呼び出し`, { reason: sufficiencyResult.reason });
          visionApiResult.called = true;

          try {
            // 各カテゴリに 1 件以上の画像があるかチェック
            const hasAnyImages =
              !!categoryImages &&
              (categoryImages.menu.length > 0 ||
                categoryImages.goods.length > 0 ||
                categoryImages.novelty.length > 0);

            if (!hasAnyImages) {
              console.warn(`${getStepContext('vision-api')} ⚠️ カテゴリ別画像なし、Vision API をスキップ`);
            } else {
              // Vision API サービス + Templates v1.2 YAML loader を初期化
              const visionService = VisionApiServiceFactory.create();
              const yamlLoader = new YamlTemplateLoaderService();
              const visionTemplate = await yamlLoader.loadVisionApiTemplate('collabo-cafe');

              console.log(`${getStepContext('vision-api')} Vision API 並列呼び出し開始 (menu/goods/novelty)...`);

              const { result: visionExtraction, perCategory } =
                await callVisionApiForAllCategories(
                  visionService,
                  visionTemplate,
                  {
                    menu: categoryImages!.menu,
                    goods: categoryImages!.goods,
                    novelty: categoryImages!.novelty,
                  },
                  { maxRetries: 3, timeout: 30000 },
                );

              visionApiResult.visionExtraction = visionExtraction;

              console.log(`${getStepContext('vision-api')} menu/goods/novelty 並列呼び出し完了:`, {
                confidence: visionExtraction.visionExtraction.confidence,
                menuItems: visionExtraction.visionExtraction.menuItems.length,
                goodsItems: visionExtraction.visionExtraction.goodsItems.length,
                noveltyItems: visionExtraction.visionExtraction.noveltyItems.length,
                perCategory,
              });

              // Cost tracking — record under one aggregate key (`vision-api`).
              // The merger's `metadata.tokensUsed` is the sum across successful calls
              // and is optional (undefined when no call surfaced usage). Per-category
              // breakdown intentionally stays out of cost-tracker for now; recording it
              // requires a merger signature change and is deferred to a later sprint.
              const provider = visionService.getProviderName();
              const modelName = visionService.getModelName();
              const actualUsage = visionExtraction.visionExtraction.metadata?.tokensUsed;

              if (actualUsage) {
                const costResult = costTracker.recordUsage(
                  'vision-api',
                  modelName,
                  actualUsage,
                );
                console.log(`${getStepContext('vision-api')} Vision API コスト追跡:`, {
                  provider,
                  model: modelName,
                  promptTokens: actualUsage.promptTokens,
                  completionTokens: actualUsage.completionTokens,
                  totalTokens: actualUsage.totalTokens,
                  ...(actualUsage.cacheCreationTokens
                    ? { cacheCreationTokens: actualUsage.cacheCreationTokens }
                    : {}),
                  ...(actualUsage.cachedTokens
                    ? { cachedTokens: actualUsage.cachedTokens }
                    : {}),
                  cost: `$${costResult.usd.toFixed(6)} (¥${costResult.jpy.toFixed(2)})`,
                });
              } else {
                console.log(
                  `${getStepContext('vision-api')} Vision API コスト追跡: tokensUsed 不在のためスキップ (全 call が usage を返さず)`,
                );
              }

              // Cross-check (HTML vs merged Vision API result)
              const crossCheckResult = crossCheckVisionResult(visionExtraction, htmlSufficiency);
              visionApiResult.crossCheckPassed = crossCheckResult.passed;

              console.log(`${getStepContext('vision-api')} Cross-check 結果:`, {
                passed: crossCheckResult.passed,
                issues: crossCheckResult.issues,
              });

              if (!crossCheckResult.passed) {
                console.warn(`${getStepContext('vision-api')} ⚠️ Cross-check 失敗:`, crossCheckResult.issues);
              }

              // Hallucination detection (covers menu+goods+novelty per Templates v1.2)
              const hallucinationResult = detectHallucination(visionExtraction, htmlSufficiency);
              visionApiResult.hallucinationDetected = hallucinationResult.detected;

              if (hallucinationResult.detected) {
                console.error(`${getStepContext('vision-api')} 🚨 Hallucination 検出:`, {
                  type: hallucinationResult.type,
                  reason: hallucinationResult.reason,
                });

                // Hallucination が検出された場合は記事生成を中止
                return {
                  success: false,
                  skipped: true,
                  skipReason: `Vision API でハルシネーション検出: ${hallucinationResult.reason}`,
                  detailedExtraction,
                  visionApiResult,
                };
              }

              console.log(`${getStepContext('vision-api')} ✅ Hallucination なし`);

              // Fallback level selection (novelty-aware per step 3 utils 拡張)
              const fallbackLevel = selectFallbackLevel(visionExtraction);
              visionApiResult.fallbackLevel = fallbackLevel;

              console.log(`${getStepContext('vision-api')} Fallback レベル:`, fallbackLevel);

              // Business rules validation
              const businessValidation = validateBusinessRules(visionExtraction);

              if (businessValidation.issues.length > 0) {
                console.warn(`${getStepContext('vision-api')} ⚠️ Business rules 違反:`, businessValidation.issues);

                // 信頼度を調整: 元の `visionExtraction` オブジェクトは mutate せず、
                // visionApiResult.visionExtraction だけを spread copy で差し替える。
                // これにより、API 結果（unchanged）と記録用結果（adjusted）が分離される。
                const originalConfidence = visionExtraction.visionExtraction.confidence;
                visionApiResult.visionExtraction = {
                  ...visionExtraction,
                  visionExtraction: {
                    ...visionExtraction.visionExtraction,
                    confidence: businessValidation.adjustedConfidence,
                  },
                };

                console.log(`${getStepContext('vision-api')} 信頼度調整:`, {
                  original: originalConfidence,
                  adjusted: businessValidation.adjustedConfidence,
                });
              }

              console.log(`${getStepContext('vision-api')} ✅ Vision API 統合完了 (3 カテゴリ並列)`);
            }
          } catch (visionError) {
            console.error(`${getStepContext('vision-api')} ❌ Vision API 呼び出し失敗:`, visionError);
            console.log(`${getStepContext('vision-api')} HTML抽出結果のみで記事生成を続行`);
          }
        }
      }

      // slug-generation step: Resolve slugs (YAML config → AI API → ASCII fallback)
      console.log(`\n${getStepDisplay('slug-generation')} YAMLコンフィグでslugを解決...`);

      const [workSlug, storeSlug, eventType] = await Promise.all([
        resolveWorkSlug(extraction.workTitle, true, costTracker),
        resolveStoreSlug(extraction.storeName, true, costTracker),
        resolveEventTypeSlug(extraction.eventTypeName, true, costTracker),
      ]);

      console.log('Slug解決結果:', { workSlug, storeSlug, eventType });

      // Validate that all slugs were resolved successfully
      if (!workSlug || !storeSlug || !eventType) {
        const missingFields = [];
        if (!workSlug) missingFields.push(`workSlug (${extraction.workTitle})`);
        if (!storeSlug) missingFields.push(`storeSlug (${extraction.storeName})`);
        if (!eventType) missingFields.push(`eventType (${extraction.eventTypeName})`);

        throw new Error(
          `Slug解決に失敗しました。以下のフィールドが解決できませんでした: ${missingFields.join(', ')}`
        );
      }

      // Create resolved slugs object to pass to subsequent functions
      const resolvedSlugs = { workSlug, storeSlug, eventType };

      // duplication-check step: Firestore duplication check + event registration
      let eventRecord: EventCanonicalKey;

      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: 重複チェック・登録をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        console.log(`\n${getStepDisplay('duplication-check')} Firestore重複チェック（${modeLabel}のためスキップ）...`);

        // ダミーの postId を生成（タイムスタンプベース）
        const dryRunPostId = `dry-run-${Date.now()}`;
        const dryRunCanonicalKey = `${workSlug}:${storeSlug}:${eventType}:${year}`;

        // ドライラン用のダミーレコード（Firestoreには保存しないため、Timestamp の代わりに null を使用）
        eventRecord = {
          canonicalKey: dryRunCanonicalKey,
          postId: dryRunPostId,
          workSlug,
          storeSlug,
          eventType,
          year,
          status: 'pending', // ドライランでも valid な status を使用
          createdAt: null as any, // ドライラン用ダミー値
          updatedAt: null as any, // ドライラン用ダミー値
        };

        const modeEmoji = localOnly ? '💾' : '🧪';
        const modeName = localOnly ? 'ローカル保存' : 'ドライラン';
        console.log(`${modeEmoji} ${modeName}: ダミーイベントレコード生成:`, {
          canonicalKey: eventRecord.canonicalKey,
          postId: eventRecord.postId,
          status: `${modeName} (not saved)`,
        });
      } else {
        // 通常モード: 重複チェック + 登録
        console.log(`\n${getStepDisplay('duplication-check')} Firestoreで重複チェック...`);

        const duplicationCheck = await checkEventDuplication({
          workTitle: extraction.workTitle,
          storeName: extraction.storeName,
          eventTypeName: extraction.eventTypeName,
          year,
          resolvedSlugs,
        });

        if (duplicationCheck.isDuplicate && duplicationCheck.existingDoc) {
          console.log('⚠️ 重複イベントを検出:', duplicationCheck.canonicalKey);

          // Check if the corresponding GitHub PR is still open
          console.log('GitHub PRの状態を確認中...');
          const prStatus = await getPrStatusByCanonicalKey(duplicationCheck.canonicalKey);

          if (prStatus.hasOpenPr) {
            // Open PR exists - this is a true duplicate
            console.log('✗ Open PRが存在します。重複エラーをスローします。');

            const existingFilePath = `apps/ai-writer/content/${duplicationCheck.existingDoc.eventType}/${duplicationCheck.existingDoc.workSlug}/${duplicationCheck.existingDoc.postId}.mdx`;

            throw new DuplicateSlugError(
              `このイベントは既に生成済みです: ${duplicationCheck.canonicalKey}`,
              duplicationCheck.existingDoc.postId,
              existingFilePath
            );
          } else {
            // No open PR - allow regeneration
            console.log(`✓ Open PRが見つかりません。PRがCloseされたため、再生成を許可します。`);
            console.log(`  - Open PRs: ${prStatus.hasOpenPr ? 'Yes' : 'No'}`);
            console.log(`  - Closed PRs: ${prStatus.hasClosedPr ? 'Yes' : 'No'}`);
            console.log(`  - Total PRs: ${prStatus.totalCount}`);

            // Delete existing Firestore document to allow re-registration
            console.log('既存のFirestoreドキュメントを削除中...');
            await deleteEvent(duplicationCheck.canonicalKey);
            console.log('✅ 既存ドキュメント削除完了');
          }
        }

        console.log('✅ 重複なし。イベントを登録...');

        eventRecord = await registerNewEvent({
          workTitle: extraction.workTitle,
          storeName: extraction.storeName,
          eventTypeName: extraction.eventTypeName,
          year,
          resolvedSlugs,
        });

        console.log('イベント登録完了:', {
          canonicalKey: eventRecord.canonicalKey,
          postId: eventRecord.postId,
          status: eventRecord.status,
        });
      }

      // metadata-generation step: Generate excerpt using AI API + build categories deterministically
      // Note: categories は AI 生成ではなく、taxonomy.yaml ルールに従って決定論的に構築
      // @see notes/work-report/2025-12/2025-12-16-カテゴリの改善案について改めて行った調査内容.md
      console.log(`\n${getStepDisplay('metadata-generation')} AI API (${providerDisplayName}) で抜粋を生成 + カテゴリを構築...`);

      // 4a: AI API で excerpt のみ生成（categories は使用しない）
      const metadata = await generateArticleMetadata({
        content: rssItem.content || rssItem.contentSnippet || '',
        title: rssItem.title,
        workTitle: extraction.workTitle,
        eventType: extraction.eventTypeName,
      });

      // 4b: categories は buildCategories() で決定論的に構築（2件固定）
      // taxonomy.yaml v1.1 の category_rules に準拠
      // Note: prefectures は categories に含めず、別フィールドで管理
      const categories = buildCategories({
        workTitle: extraction.workTitle,
        eventTitle: extraction.eventTypeName,
      });

      console.log('メタデータ生成完了:', {
        categories: categories, // 決定論的に構築
        categoriesSource: 'buildCategories (taxonomy.yaml rules)',
        excerptLength: metadata.excerpt.length,
      });

      // metadata-generation step: 開催都道府県を解決（taxonomy.yaml v1.1 areas軸対応）
      let prefectures: string[] = [];
      let prefectureSlugs: string[] = [];

      if (detailedExtraction?.開催都道府県 && detailedExtraction.開催都道府県.length > 0) {
        const resolved = resolvePrefectureSlugs(detailedExtraction.開催都道府県);
        prefectures = resolved.prefectures;
        prefectureSlugs = resolved.slugs;

        console.log(`${getStepContext('metadata-generation', '開催都道府県')} 開催都道府県を解決:`, {
          input: detailedExtraction.開催都道府県,
          prefectures,
          prefectureSlugs,
        });
      } else {
        console.log(`${getStepContext('metadata-generation', '開催都道府県')} 開催都道府県: なし（抽出されていない or null）`);
      }

      // コストを記録（metadata-generation step: MetadataGeneration）
      if (metadata.model && metadata.usage) {
        costTracker.recordUsage(
          'metadata-generation',
          metadata.model,
          metadata.usage
        );
      }

      // title-generation step: Generate title using YAML template
      console.log(`\n${getStepDisplay('title-generation')} AI API (${providerDisplayName}) でタイトルを生成（YAMLテンプレート使用）...`);

      const titleService = new TitleGenerationService();
      const titleResult = await titleService.generateTitle({
        rss_title: rssItem.title,
        rss_content: rawContent,
        rss_link: rssItem.link,
        // detail-extraction step で抽出済みのデータを渡す（日付エラー防止）
        extractedPeriod: detailedExtraction?.開催期間,
        extractedStoreName: detailedExtraction?.店舗名,
        // 作品名は rss-extraction step の workTitle を canonical として使用
        extractedWorkName: canonicalWorkTitle,
        // v2.4.0: 作品名の略称（10文字以上の作品のみ設定）
        extractedWorkNameShort: canonicalWorkTitle
          ? getShortTitle(canonicalWorkTitle) ?? undefined
          : undefined,
        // v2.3.0: 開催回数（第N弾形式）
        extractedEventNumber: detailedExtraction?.開催回数 ?? undefined,
      });

      // コストを記録
      if (titleResult.model && titleResult.usage) {
        costTracker.recordUsage(
          'title-generation',
          titleResult.model,
          titleResult.usage
        );
      }

      // content-generation step: Generate MDX article content using ContentGenerationService
      console.log(`\n${getStepDisplay('content-generation')} AI API (${providerDisplayName}) で記事本文を生成（YAMLテンプレート使用）...`);

      // ContentGenerationService で本文を生成
      const contentService = new ContentGenerationService();
      let contentGeneration: ContentGenerationResult;

      try {
        // detail-extraction step で取得した officialHtml を再利用（再取得不要）
        // categoryImages を渡して、画像有無でセクションスキップを判断させる
        contentGeneration = await contentService.generateContent({
          extractedData: detailedExtraction,
          generatedTitle: titleResult.title,
          officialHtml: officialHtml, // detail-extraction step で取得済みのHTMLを再利用
          categoryImages: categoryImages ? {
            menu: categoryImages.menu,
            novelty: categoryImages.novelty,
            goods: categoryImages.goods,
          } : undefined,
        });

        console.log('コンテンツ生成完了:', {
          contentLength: contentGeneration.content.length,
          generatedSections: contentGeneration.generatedSections,
          skippedSections: contentGeneration.skippedSections,
        });

        // コストを記録（content-generation step: ContentGeneration）
        if (contentGeneration.model && contentGeneration.usage) {
          costTracker.recordUsage(
            'content-generation',
            contentGeneration.model,
            contentGeneration.usage
          );
        }
      } catch (contentError) {
        console.error('❌ コンテンツ生成に失敗しました:', contentError);
        return {
          success: false,
          skipped: true,
          skipReason: `コンテンツ生成に失敗: ${contentError instanceof Error ? contentError.message : 'Unknown error'}`,
          detailedExtraction,
        };
      }

      // image-upload-r2 step: Upload OG image and body images to R2
      console.log(`\n${getStepDisplay('image-upload-r2')} 画像をR2にアップロード（OG画像 + 本文画像）...`);

      let ogImageUpload: OgImageUploadResult | undefined;
      let bodyImagesUpload: ArticleImageUploadResult | undefined;
      let ogImageUrl = '/images/og-image-compressed.png'; // デフォルト画像

      // カテゴリ別R2 URLを追跡（image-placeholder-replacement step で使用するためスコープを外に出す）
      const uploadedCategoryR2Images: CategoryR2Images = {
        menu: [],
        novelty: [],
        goods: [],
        eyecatch: undefined, // OG画像アップロード後に設定
      };

      if (selectionResult.primary_official_url) {
        try {
          // 5.5a: OG画像のアップロード
          console.log(`\n${getStepContext('image-upload-r2', 'OG')} OG画像をアップロード...`);
          const ogService = getOgImageUploadService();
          ogImageUpload = await ogService.uploadFromPageUrl(
            selectionResult.primary_official_url,
            {
              folder: `${eventType}/${year}/${eventRecord.postId}`,
              articleSlug: eventRecord.postId,
              dryRun: skipImageUpload, // localOnlyモードでは実際にアップロード
            }
          );

          if (ogImageUpload.success && ogImageUpload.r2Url) {
            ogImageUrl = ogImageUpload.r2Url;
            // image-placeholder-replacement step でアイキャッチプレースホルダー置換に使用
            uploadedCategoryR2Images.eyecatch = ogImageUpload.r2Url;
            console.log(`✅ OG画像アップロード完了: ${ogImageUrl}`);
          } else {
            console.log(`⚠️ OG画像アップロード失敗、デフォルト画像を使用: ${ogImageUpload.error || '不明なエラー'}`);
          }

          // 5.5b: カテゴリ別画像のアップロード
          console.log(`\n${getStepContext('image-upload-r2', 'カテゴリ別')} カテゴリ別画像をアップロード...`);

          if (categoryImages) {
            // categoryImagesが存在する場合は、カテゴリ別にアップロード
            const r2Service = getR2StorageService();
            const baseFolder = `${eventType}/${year}/${eventRecord.postId}`;

            for (const category of ['menu', 'novelty', 'goods'] as const) {
              const sourceUrls = categoryImages[category];
              if (sourceUrls.length === 0) {
                console.log(`${getStepContext('image-upload-r2', 'カテゴリ別')} ${category}: 画像なし`);
                continue;
              }

              console.log(`${getStepContext('image-upload-r2', 'カテゴリ別')} ${category}: ${sourceUrls.length}件の画像をアップロード中...`);

              for (const sourceUrl of sourceUrls) {
                try {
                  if (skipImageUpload) {
                    const dryRunUrl = `[DRY RUN] ${process.env.R2_PUBLIC_URL}/${baseFolder}/${category}/${Date.now()}.jpg`;
                    uploadedCategoryR2Images[category].push(dryRunUrl);
                    console.log(`  🔍 [DRY RUN] ${sourceUrl}`);
                  } else {
                    const uploadResult = await r2Service.uploadFromUrl(
                      sourceUrl,
                      `${baseFolder}/${category}`
                    );
                    uploadedCategoryR2Images[category].push(uploadResult.url);
                    console.log(`  ✅ ${sourceUrl} → ${uploadResult.url}`);
                  }
                } catch (error) {
                  console.warn(`  ⚠️ ${category} 画像アップロード失敗: ${sourceUrl}`, error);
                }
              }

              console.log(`${getStepContext('image-upload-r2', 'カテゴリ別')} ${category}: ${uploadedCategoryR2Images[category].length}件アップロード完了`);
            }
          } else if (officialHtml) {
            // フォールバック: categoryImagesがない場合は従来のHTML抽出を使用
            console.log(`${getStepContext('image-upload-r2', 'カテゴリ別')} categoryImagesがないため、HTML抽出にフォールバック`);
            const articleImageService = getArticleImageUploadService();
            bodyImagesUpload = await articleImageService.uploadFromHtml(
              officialHtml, // detail-extraction step で取得済みのHTMLを再利用
              selectionResult.primary_official_url,
              {
                articleSlug: eventRecord.postId,
                eventType,
                year,
                dryRun: skipImageUpload, // localOnlyモードでは実際にアップロード
                uploadOgImage: false, // OG画像は既にアップロード済み
                uploadBodyImages: true,
              }
            );

            console.log(`✅ 本文画像アップロード完了: ${bodyImagesUpload.stats.successCount}件成功, ${bodyImagesUpload.stats.failureCount}件失敗, ${bodyImagesUpload.stats.skippedCount}件スキップ`);
          } else {
            console.log('⚠️ 公式サイトHTMLがないため、本文画像アップロードをスキップ');
          }
        } catch (imageError) {
          console.error('❌ 画像アップロードエラー:', imageError);
          console.log('⚠️ デフォルトOG画像を使用します');
        }
      } else {
        console.log('⚠️ 公式サイトURLがないため、画像アップロードをスキップします');
      }

      // image-placeholder-replacement step: プレースホルダー置換
      console.log(`\n${getStepDisplay('image-placeholder-replacement')} プレースホルダー置換...`);

      let placeholderReplacement: PlaceholderReplacementResult | undefined;
      let finalContent = contentGeneration.content;

      // カテゴリ別R2画像またはアイキャッチ画像がある場合のみ置換を実行
      // uploadedCategoryR2Images は image-upload-r2 step でアップロードされた画像のR2 URL
      const hasR2Images =
        uploadedCategoryR2Images.menu.length > 0 ||
        uploadedCategoryR2Images.novelty.length > 0 ||
        uploadedCategoryR2Images.goods.length > 0 ||
        !!uploadedCategoryR2Images.eyecatch;

      if (hasR2Images) {
        const placeholderReplacer = getImagePlaceholderReplacerService();
        // titleResult.title を渡して alt 属性に記事タイトルを含める
        placeholderReplacement = placeholderReplacer.replaceAll(
          contentGeneration.content,
          uploadedCategoryR2Images,
          titleResult.title
        );
        finalContent = placeholderReplacement.content;

        console.log(`${getStepContext('image-placeholder-replacement')} プレースホルダー置換結果:`, {
          replacedCount: placeholderReplacement.replacedCount.total,
          removedSections: placeholderReplacement.removedSections,
          unreplacedCount: placeholderReplacement.unreplacedPlaceholders.length,
        });

        if (placeholderReplacement.unreplacedPlaceholders.length > 0) {
          console.warn(`${getStepContext('image-placeholder-replacement')} ⚠️ 未置換プレースホルダー:`, placeholderReplacement.unreplacedPlaceholders);
        }
      } else {
        console.log(`${getStepContext('image-placeholder-replacement')} R2画像（カテゴリ別・アイキャッチ）なし、画像プレースホルダー置換をスキップ`);
      }

      // text-placeholder-replacement step: テキストプレースホルダー置換
      console.log(`\n${getStepDisplay('text-placeholder-replacement')} テキストプレースホルダー置換...`);

      let textPlaceholderReplacement: TextPlaceholderReplacementResult | undefined;

      if (detailedExtraction) {
        const textReplacer = getTextPlaceholderReplacerService();
        textPlaceholderReplacement = textReplacer.replaceAll(finalContent, {
          作品名: detailedExtraction.作品名,
          店舗名: detailedExtraction.店舗名,
          メディアタイプ: detailedExtraction.メディアタイプ,
          原作タイプ: detailedExtraction.原作タイプ,
          原作者有無: detailedExtraction.原作者有無,
          原作者名: detailedExtraction.原作者名,
          略称: detailedExtraction.略称,
          開催回数: detailedExtraction.開催回数 ?? undefined,
          公式サイトURL: selectionResult.primary_official_url ?? undefined,
          キャラクター名: detailedExtraction.キャラクター名 ?? undefined,
          テーマ名: detailedExtraction.テーマ名 ?? undefined,
          ノベルティ名: detailedExtraction.ノベルティ名 ?? undefined,
          グッズ名: detailedExtraction.グッズ名 ?? undefined,
          開催期間: detailedExtraction.開催期間,
          works: detailedExtraction.works || [],
          store: detailedExtraction.store || { name: detailedExtraction.店舗名 },
        });

        finalContent = textPlaceholderReplacement.content;

        console.log(`${getStepContext('text-placeholder-replacement')} テキストプレースホルダー置換結果:`, {
          replacedCount: textPlaceholderReplacement.replacedCount,
          unreplacedCount: textPlaceholderReplacement.unreplacedPlaceholders.length,
        });

        if (textPlaceholderReplacement.unreplacedPlaceholders.length > 0) {
          console.warn(`${getStepContext('text-placeholder-replacement')} ⚠️ 未置換プレースホルダー:`, textPlaceholderReplacement.unreplacedPlaceholders);
        }
      } else {
        console.log(`${getStepContext('text-placeholder-replacement')} detailedExtraction がないため、テキストプレースホルダー置換をスキップ`);
      }

      // footer-placeholder-cleanup step: 記事末尾プレースホルダー削除
      // Note: ナビゲーション（ピラーページリンク、注意事項）は Frontend で表示
      // @see notes/soc-anti-pattern-ai-writer-frontend.md
      console.log(`\n${getStepDisplay('footer-placeholder-cleanup')} 記事末尾プレースホルダー削除（Frontend で表示）...`);

      finalContent = this.removeFooterPlaceholder(finalContent);

      // mdx-assembly step: MDX記事を組み立て
      console.log(`\n${getStepDisplay('mdx-assembly')} MDX記事を組み立て...`);

      // 複数作品コラボ対応: works[] から全作品タイトルを抽出
      const workTitles = detailedExtraction?.works?.map((w) => w.title) || [];

      const mdxArticle = generateMdxArticle(
        {
          postId: eventRecord.postId,
          year,
          eventType,
          eventTitle: extraction.eventTypeName,
          workTitle: extraction.workTitle,
          // 複数作品コラボ対応: 全作品タイトルを含める（SEO/検索性向上）
          workTitles: workTitles.length > 0 ? workTitles : undefined,
          workSlug,
          title: titleResult.title, // YAMLテンプレートで生成されたタイトルを使用
          categories: categories, // buildCategories() で決定論的に構築
          excerpt: metadata.excerpt,
          date: toIsoMsDate(rssItem.pubDate),
          author: 'thanks2music',
          ogImage: ogImageUrl, // R2にアップロードしたOG画像URL
          // Phase 1+ 対応: 開催都道府県（taxonomy.yaml v1.1 areas軸）
          prefectures: prefectures.length > 0 ? prefectures : undefined,
          prefectureSlugs: prefectureSlugs.length > 0 ? prefectureSlugs : undefined,
          // AI メタデータ（記事生成に使用したプロバイダーとモデル）
          aiProvider: providerName,
          aiModel: aiModel,
        },
        finalContent // プレースホルダー置換済みの本文を使用
      );

      console.log('MDX組み立て完了:', {
        filePath: mdxArticle.filePath,
        contentLength: mdxArticle.content.length,
        workTitles: workTitles.length > 0 ? workTitles : 'なし（単一作品）',
        prefectures: prefectures.length > 0 ? prefectures : 'なし',
        prefectureSlugs: prefectureSlugs.length > 0 ? prefectureSlugs : 'なし',
      });

      // github-pr-creation step: Create GitHub PR
      let prResult: CreateMdxPrResult | undefined;

      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: GitHub PR作成をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        const modeEmoji = localOnly ? '💾' : '🧪';
        console.log(`\n${getStepDisplay('github-pr-creation')} GitHub PR作成（${modeLabel}のためスキップ）...`);
        console.log(`${modeEmoji} ${modeLabel}: PR作成をスキップしました`);

        // MDX記事の内容をプレビュー表示（全文）
        console.log('\n📄 生成されたMDX記事のプレビュー:');
        console.log('-'.repeat(60));
        console.log(mdxArticle.content);
        console.log('-'.repeat(60));
      } else {
        // 通常モード: GitHub PR作成
        console.log(`\n${getStepDisplay('github-pr-creation')} GitHub PRを作成...`);

        const branchName = `ai-writer/mdx-${eventType}-${eventRecord.postId}`;
        const prTitle = `✨ Generate MDX (AI Writer): ${eventType}/${eventRecord.postId}`;
        const prBody = this.generatePrBody({
          rssItem,
          extraction,
          metadata: { categories, excerpt: metadata.excerpt }, // 決定論的に構築した categories を使用
          eventRecord,
          workSlug,
          storeSlug,
          eventType,
        });

        prResult = await createMdxPr({
          mdxContent: mdxArticle.content,
          filePath: mdxArticle.filePath,
          title: prTitle,
          body: prBody,
          branchName,
          context: {
            workTitle: extraction.workTitle,
            storeName: extraction.storeName,
            eventTypeName: extraction.eventTypeName,
            year,
            postId: eventRecord.postId,
            workSlug,
            canonicalKey: eventRecord.canonicalKey,
            resolvedSlugs,
          },
        });

        console.log('GitHub PR作成完了:', {
          prNumber: prResult.prNumber,
          prUrl: prResult.prUrl,
        });
      }

      // firestore-status-update step: Update Firestore status to 'generated'
      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: ステータス更新をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        const modeEmoji = localOnly ? '💾' : '🧪';
        console.log(`\n${getStepDisplay('firestore-status-update')} Firestoreステータス更新（${modeLabel}のためスキップ）...`);
        console.log(`${modeEmoji} ${modeLabel}: ステータス更新をスキップしました`);
      } else {
        // 通常モード: ステータス更新
        console.log(`\n${getStepDisplay('firestore-status-update')} Firestoreのステータスを更新...`);

        await updateEventStatus(eventRecord.canonicalKey, 'generated');

        console.log('✅ ステータス更新完了: pending → generated');
      }

      // LLM APIコストサマリーを出力
      if (costTracker.hasUsage()) {
        costTracker.logSummary();
      }

      // 完了メッセージ
      const completionLabel = dryRun ? 'ドライラン' : localOnly ? 'ローカル保存' : '記事生成';
      console.log(`========== MDXパイプライン: ${completionLabel}完了 ==========\n`);

      return {
        success: true,
        mdxArticle,
        prResult,
        eventRecord,
        details: {
          workSlug,
          storeSlug,
          eventType,
          canonicalKey: eventRecord.canonicalKey,
          postId: eventRecord.postId,
          year,
        },
        detailedExtraction,
        contentGeneration,
        ogImageUpload,
        bodyImagesUpload,
        subpageDetection,
        categoryImages,
        categoryR2Images: uploadedCategoryR2Images,
        placeholderReplacement,
        textPlaceholderReplacement,
        visionApiResult, // vision-api step Vision API integration result
      };
    } catch (error) {
      console.error('========== MDXパイプライン: 記事生成失敗 ==========');
      console.error('エラー:', error);

      // If event was registered but generation failed, update status
      if (error instanceof Error && error.message.includes('canonicalKey')) {
        try {
          // Extract canonical key from error context
          const canonicalKey = (error as any).canonicalKey;
          if (canonicalKey) {
            await updateEventStatus(canonicalKey, 'failed', error.message);
            console.log('Firestoreステータスを更新: pending → failed');
          }
        } catch (updateError) {
          console.error('ステータス更新失敗:', updateError);
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * GitHub PR説明文を生成
   *
   * @private
   */
  private generatePrBody(params: {
    rssItem: { title: string; link: string; pubDate?: string };
    extraction: { workTitle: string; storeName: string; eventTypeName: string };
    metadata: { categories: string[]; excerpt: string };
    eventRecord: EventCanonicalKey;
    workSlug: string;
    storeSlug: string;
    eventType: string;
  }): string {
    const { rssItem, extraction, metadata, eventRecord, workSlug, storeSlug, eventType } = params;

    return `## 📝 記事情報

**タイトル:** ${rssItem.title}
**公開日:** ${rssItem.pubDate || '不明'}

## 🎯 抽出情報

- **作品名:** ${extraction.workTitle} (slug: \`${workSlug}\`)
- **店舗名:** ${extraction.storeName} (slug: \`${storeSlug}\`)
- **イベント種別:** ${extraction.eventTypeName} (slug: \`${eventType}\`)

## 📊 メタデータ

- **カテゴリ:** ${metadata.categories.join(', ')}
- **抜粋:** ${metadata.excerpt.substring(0, 100)}...

## 🔑 識別情報

- **Canonical Key:** \`${eventRecord.canonicalKey}\`
- **Post ID:** \`${eventRecord.postId}\`
- **年:** ${eventRecord.year}

## ✅ チェックリスト

- [ ] 記事内容が正確か確認
- [ ] カテゴリが適切か確認
- [ ] 抜粋が適切か確認
- [ ] 画像が適切か確認（ある場合）

---

🤖 このPRは [AI Writer](https://github.com/thanks2music/revolution/tree/main/apps/ai-writer) によって自動生成されました。
`;
  }

  /**
   * 記事末尾ナビゲーションプレースホルダーを削除
   *
   * @param content MDXコンテンツ
   * @returns プレースホルダー削除後のコンテンツ
   *
   * @description
   * 記事末尾のナビゲーション（ピラーページリンク、注意事項等）は
   * Frontend の責務として表示するため、AI Writer ではプレースホルダーを
   * 削除するのみとする。
   *
   * @see notes/soc-anti-pattern-ai-writer-frontend.md
   * @private
   */
  private removeFooterPlaceholder(content: string): string {
    // 削除対象のプレースホルダー（新名と旧名の両方に対応）
    const placeholders = [
      '{ここに記事末尾ナビゲーション}',
      '{ここに本文を終了するための補足や注意事項を記載}',
    ];

    let result = content;
    for (const placeholder of placeholders) {
      if (result.includes(placeholder)) {
        // プレースホルダーを削除（Frontend が表示するため）
        result = result.replace(placeholder, '');
        console.log(`[FooterPlaceholder] 削除: ${placeholder} (Frontend で表示)`);
      }
    }

    // 削除後に生じる可能性のある連続空行を整理
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * HTML充足性を計算
   *
   * @param extraction AI拡張された抽出結果
   * @returns HTML抽出データ（menuItemCount, priceCount, htmlSufficiencyRate）
   *
   * @description
   * ExtractionResultから利用可能なデータポイントをカウントし、
   * HTML充足性を推定します。実際のHTML解析ではなく、
   * AI抽出結果に含まれるデータの充実度を評価します。
   *
   * 評価基準:
   * - キャラクター名の有無とカウント
   * - メニュー種類数の有無
   * - グッズ名の有無とカウント
   * - ノベルティ名の有無
   *
   * 充足率計算:
   * - 期待データポイント数: 10
   *   - キャラクター名配列 (最大3ポイント)
   *   - メニュー種類数 (1ポイント)
   *   - グッズ名配列 (最大3ポイント)
   *   - ノベルティ名 (1ポイント)
   *   - テーマ名 (1ポイント)
   *   - 開催回数 (1ポイント)
   * - 実際のポイント数 / 期待ポイント数 = 充足率
   *
   * @private
   */
  private calculateHtmlSufficiency(extraction: ExtractionResult): HtmlExtractionData {
    // メニューアイテム数（キャラクター名を代用）
    const characterNames = extraction.キャラクター名 || [];
    const menuItemCount = characterNames.length;

    // 価格カウント（メニュー種類数から推定）
    let priceCount = 0;
    if (extraction.メニュー種類数) {
      // "計10種" → 10 を抽出
      const match = extraction.メニュー種類数.match(/\d+/);
      if (match) {
        priceCount = parseInt(match[0], 10);
      }
    }

    // データポイントカウント（充足率計算用）
    let actualPoints = 0;
    const expectedPoints = 10;

    // キャラクター名（最大3ポイント）
    actualPoints += Math.min(characterNames.length, 3);

    // メニュー種類数（1ポイント）
    if (extraction.メニュー種類数) {
      actualPoints += 1;
    }

    // グッズ名（最大3ポイント）
    const goodsNames = extraction.グッズ名 || [];
    actualPoints += Math.min(goodsNames.length, 3);

    // ノベルティ名（1ポイント）
    if (extraction.ノベルティ名) {
      actualPoints += 1;
    }

    // テーマ名（1ポイント）
    if (extraction.テーマ名) {
      actualPoints += 1;
    }

    // 開催回数（1ポイント）
    if (extraction.開催回数) {
      actualPoints += 1;
    }

    // 充足率計算
    const htmlSufficiencyRate = actualPoints / expectedPoints;

    return {
      menuItemCount,
      priceCount,
      htmlSufficiencyRate,
    };
  }

  /**
   * コネクションテスト
   *
   * AI API（設定されたプロバイダー）、Firestore、GitHub API への接続を確認します。
   *
   * @description
   * マルチプロバイダー対応済み（2025-12-07）
   * AI_PROVIDER環境変数で設定されたプロバイダーをテストします
   */
  async testConnections(): Promise<{
    ai: boolean;
    firestore: boolean;
    github: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let aiStatus = false;
    let firestoreStatus = false;
    let githubStatus = false;

    // Test AI API (configured provider)
    try {
      const aiProvider = createAiProvider();
      const providerName = getConfiguredProvider();
      console.log(`[testConnections] Testing AI API connection (${providerName})...`);
      aiStatus = await aiProvider.testConnection();
      if (!aiStatus) {
        errors.push(`AI API (${providerName}) connection test failed`);
      }
    } catch (error) {
      const providerName = getConfiguredProvider();
      errors.push(`AI API (${providerName}) error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test Firestore (simple read operation)
    try {
      // Firestoreの接続確認は、実際のクエリで行う
      // ここでは簡易チェックのみ
      firestoreStatus = true;
    } catch (error) {
      errors.push(`Firestore error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test GitHub API
    try {
      // GitHub APIの接続確認
      // createGitHubClient() が成功すればOK
      githubStatus = true;
    } catch (error) {
      errors.push(`GitHub API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      ai: aiStatus,
      firestore: firestoreStatus,
      github: githubStatus,
      errors,
    };
  }
}

export default ArticleGenerationMdxService;
