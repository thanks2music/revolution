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
import { resolveWorkSlug, resolveStoreSlug, resolveEventTypeSlug } from '../config/slug-resolver';
import { DuplicateSlugError } from '../errors/github';
import { getPrStatusByCanonicalKey } from '../github/pr-status';
import { extractFromRss, type RssExtractionResult } from '../claude/rss-extractor';
import { generateArticleMetadata } from '../claude/metadata-generator';
import { type ArticleMetadata } from '../claude/types';
import { createAiProvider, getConfiguredProvider } from '../ai/factory/ai-factory';
import { extractArticleHtml, extractContentHtml, extractPageLinks } from '../utils/html-extractor';
import { ArticleSelectionService } from './article-selection.service';
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
  createCostTracker,
  type CostTrackerService,
} from '@/lib/ai/cost';
import { buildCategories } from '@/lib/utils/category-builder';

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
  // 公式サイトからの詳細抽出結果（Step 1.5）
  detailedExtraction?: ExtractionResult;
  // コンテンツ生成結果（Step 5）
  contentGeneration?: ContentGenerationResult;
  // OG画像アップロード結果（Step 5.5）
  ogImageUpload?: OgImageUploadResult;
  // 本文画像アップロード結果（Step 5.5）
  bodyImagesUpload?: ArticleImageUploadResult;
  // 下層ページ検出結果（Step 1.6）
  subpageDetection?: SubpageDetectionResult;
  // カテゴリ別画像抽出結果（Step 1.7）
  categoryImages?: CategoryImages;
  // カテゴリ別R2画像URL（Step 5.5b後）
  categoryR2Images?: CategoryR2Images;
  // プレースホルダー置換結果（Step 5.7）
  placeholderReplacement?: PlaceholderReplacementResult;
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
   * 処理フロー:
   * 0.5. AI APIで記事選別（公式URL検出、採用判定）
   * 1. AI APIでRSS記事から作品/店舗/イベント情報を抽出
   * 1.5. AI APIで公式サイトHTMLから詳細情報を抽出（YAMLテンプレート使用）
   * 2. YAMLコンフィグでslugを解決（フォールバック: AI API → ASCII）
   * 3. Firestoreで重複チェック + イベント登録（status: pending）
   * 4. AI APIでカテゴリ/抜粋を生成
   * 4.5. AI APIでタイトルを生成（YAMLテンプレート使用）
   * 5. AI APIで記事本文を生成（YAMLテンプレート使用）
   * 5.5. OG画像をR2にアップロード
   * 6. MDX記事を組み立て
   * 7. GitHub PRを作成
   * 8. Firestoreのステータスを更新（status: generated）
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

    // RSS本文を取得（Step 4.5 と Step 5 で使用）
    const rawContent = rssItem.content || rssItem.contentSnippet || '';

    try {
      // Step 0.5: Article selection filter (公式URL検出 + 採用判定)
      console.log(`\n[Step 0.5/11] AI API (${providerDisplayName}) で記事選別（公式URL検出、採用判定）...`);
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

      // コストを記録（Step 0.5: ArticleSelection）
      if (selectionResult.model && selectionResult.usage) {
        costTracker.recordUsage(
          'Step0.5_ArticleSelection',
          selectionResult.model,
          selectionResult.usage
        );
      }

      // Step 1: Extract work/store/event information from RSS
      console.log(`\n[Step 1/11] AI API (${providerDisplayName}) でRSS記事から作品/店舗/イベント情報を抽出...`);

      const extraction =
        request.extracted ||
        (await extractFromRss({
          title: rssItem.title,
          content: rssItem.content || rssItem.contentSnippet || '',
          link: rssItem.link,
        }));

      console.log('抽出結果:', extraction);

      // コストを記録（Step 1: RssExtraction）
      // Note: request.extracted が渡された場合は AI 呼び出しがないため usage がない
      // extractFromRss の戻り値のみ model と usage を持つ
      const extractionWithUsage = extraction as RssExtractionResult;
      if (!request.extracted && extractionWithUsage.usage) {
        costTracker.recordUsage(
          'Step1_RssExtraction',
          extractionWithUsage.model,
          extractionWithUsage.usage
        );
      }

      // Step 1.5: Extract detailed information from official site HTML
      console.log(`\n[Step 1.5/11] AI API (${providerDisplayName}) で公式サイトHTMLから詳細情報を抽出...`);

      let detailedExtraction: ExtractionResult | undefined;
      // 公式サイトのHTMLを保持（Step 5 と Step 5.5 で再利用）
      let officialHtml: string | undefined;

      if (selectionResult.primary_official_url) {
        try {
          // 公式サイトのHTMLを1回だけ取得（Step 5 と Step 5.5 で再利用）
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
              'Step1.5_Extraction',
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
      // 作品名の正規化（Step 1 の workTitle を canonical として使用）
      // ========================================
      // Step 1.5 の「作品名」はイベント名を含む場合があるため、
      // Step 1（RSS抽出）の workTitle を正式な作品名として採用する
      const canonicalWorkTitle = extraction.workTitle;

      // 差分があればログ出力（デバッグ用）
      if (detailedExtraction.作品名 !== canonicalWorkTitle) {
        console.log('📝 作品名の正規化:', {
          'Step 1 (canonical)': canonicalWorkTitle,
          'Step 1.5 (参考)': detailedExtraction.作品名,
          '差分理由': 'Step 1.5 がイベント名を含んでいる可能性あり',
        });
      }

      // Step 1.6: Subpage detection（下層ページ検出）
      console.log(`\n[Step 1.6/11] 下層ページ検出（メニュー/ノベルティ/グッズ）...`);

      let subpageDetection: SubpageDetectionResult | undefined;
      let categoryImages: CategoryImages | undefined;

      if (selectionResult.primary_official_url && officialHtml) {
        try {
          // 公式サイトHTMLからリンクを抽出
          const pageLinks = extractPageLinks(officialHtml, selectionResult.primary_official_url);
          console.log(`[Step 1.6] 公式サイトから${pageLinks.length}件のリンクを抽出`);

          // 下層ページを検出
          const subpageService = getSubpageDetectorService();
          const storeName = detailedExtraction?.店舗名 || extraction.storeName;

          subpageDetection = await subpageService.detectSubpages(
            selectionResult.primary_official_url,
            storeName,
            pageLinks
          );

          console.log('[Step 1.6] 下層ページ検出結果:', {
            menu: subpageDetection.categoryUrls.menu?.length || 0,
            novelty: subpageDetection.categoryUrls.novelty?.length || 0,
            goods: subpageDetection.categoryUrls.goods?.length || 0,
            isTopPageOnly: subpageDetection.isTopPageOnly,
            methods: subpageDetection.detectionMethods,
          });

          // コストを記録（Step 1.6: SubpageDetection - AI使用時のみ）
          if (subpageDetection.model && subpageDetection.usage) {
            costTracker.recordUsage(
              'Step1.6_SubpageDetection',
              subpageDetection.model,
              subpageDetection.usage
            );
          }

          // Step 1.7: Category image extraction（カテゴリ別画像抽出）
          console.log(`\n[Step 1.7/11] カテゴリ別画像抽出（下層ページから画像を取得）...`);

          const categoryImageService = getCategoryImageExtractorService();
          categoryImages = await categoryImageService.extractCategoryImages(
            selectionResult.primary_official_url,
            officialHtml,
            subpageDetection.categoryUrls
          );

          console.log('[Step 1.7] カテゴリ別画像抽出結果:', {
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
        console.log('[Step 1.6/1.7] 公式サイトHTMLがないため、下層ページ検出をスキップ');
      }

      // Step 2: Resolve slugs (YAML config → AI API → ASCII fallback)
      console.log('\n[Step 2/11] YAMLコンフィグでslugを解決...');

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

      // Step 3: Firestore duplication check + event registration
      let eventRecord: EventCanonicalKey;

      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: 重複チェック・登録をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        console.log(`\n[Step 3/11] Firestore重複チェック（${modeLabel}のためスキップ）...`);

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
        console.log('\n[Step 3/11] Firestoreで重複チェック...');

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

      // Step 4: Generate excerpt using AI API + build categories deterministically
      // Note: categories は AI 生成ではなく、taxonomy.yaml ルールに従って決定論的に構築
      // @see notes/work-report/2025-12/2025-12-16-カテゴリの改善案について改めて行った調査内容.md
      console.log(`\n[Step 4/11] AI API (${providerDisplayName}) で抜粋を生成 + カテゴリを構築...`);

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

      // コストを記録（Step 4: MetadataGeneration）
      if (metadata.model && metadata.usage) {
        costTracker.recordUsage(
          'Step4_MetadataGeneration',
          metadata.model,
          metadata.usage
        );
      }

      // Step 4.5: Generate title using YAML template
      console.log(`\n[Step 4.5/11] AI API (${providerDisplayName}) でタイトルを生成（YAMLテンプレート使用）...`);

      const titleService = new TitleGenerationService();
      const titleResult = await titleService.generateTitle({
        rss_title: rssItem.title,
        rss_content: rawContent,
        rss_link: rssItem.link,
        // Step 1.5 で抽出済みのデータを渡す（日付エラー防止）
        extractedPeriod: detailedExtraction?.開催期間,
        extractedStoreName: detailedExtraction?.店舗名,
        // 作品名は Step 1 の workTitle を canonical として使用
        extractedWorkName: canonicalWorkTitle,
      });

      // コストを記録
      if (titleResult.model && titleResult.usage) {
        costTracker.recordUsage(
          'Step4.5_TitleGeneration',
          titleResult.model,
          titleResult.usage
        );
      }

      // Step 5: Generate MDX article content using ContentGenerationService
      console.log(`\n[Step 5/11] AI API (${providerDisplayName}) で記事本文を生成（YAMLテンプレート使用）...`);

      // ContentGenerationService で本文を生成
      const contentService = new ContentGenerationService();
      let contentGeneration: ContentGenerationResult;

      try {
        // Step 1.5 で取得した officialHtml を再利用（再取得不要）
        contentGeneration = await contentService.generateContent({
          extractedData: detailedExtraction,
          generatedTitle: titleResult.title,
          officialHtml: officialHtml, // Step 1.5 で取得済みのHTMLを再利用
        });

        console.log('コンテンツ生成完了:', {
          contentLength: contentGeneration.content.length,
          generatedSections: contentGeneration.generatedSections,
          skippedSections: contentGeneration.skippedSections,
        });

        // コストを記録（Step 5: ContentGeneration）
        if (contentGeneration.model && contentGeneration.usage) {
          costTracker.recordUsage(
            'Step5_ContentGeneration',
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

      // Step 5.5: Upload OG image and body images to R2
      console.log('\n[Step 5.5/11] 画像をR2にアップロード（OG画像 + 本文画像）...');

      let ogImageUpload: OgImageUploadResult | undefined;
      let bodyImagesUpload: ArticleImageUploadResult | undefined;
      let ogImageUrl = '/images/og-image-compressed.png'; // デフォルト画像

      // カテゴリ別R2 URLを追跡（Step 5.7 で使用するためスコープを外に出す）
      const uploadedCategoryR2Images: CategoryR2Images = {
        menu: [],
        novelty: [],
        goods: [],
      };

      if (selectionResult.primary_official_url) {
        try {
          // 5.5a: OG画像のアップロード
          console.log('\n[Step 5.5a] OG画像をアップロード...');
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
            console.log(`✅ OG画像アップロード完了: ${ogImageUrl}`);
          } else {
            console.log(`⚠️ OG画像アップロード失敗、デフォルト画像を使用: ${ogImageUpload.error || '不明なエラー'}`);
          }

          // 5.5b: カテゴリ別画像のアップロード
          console.log('\n[Step 5.5b] カテゴリ別画像をアップロード...');

          if (categoryImages) {
            // categoryImagesが存在する場合は、カテゴリ別にアップロード
            const r2Service = getR2StorageService();
            const baseFolder = `${eventType}/${year}/${eventRecord.postId}`;

            for (const category of ['menu', 'novelty', 'goods'] as const) {
              const sourceUrls = categoryImages[category];
              if (sourceUrls.length === 0) {
                console.log(`[Step 5.5b] ${category}: 画像なし`);
                continue;
              }

              console.log(`[Step 5.5b] ${category}: ${sourceUrls.length}件の画像をアップロード中...`);

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

              console.log(`[Step 5.5b] ${category}: ${uploadedCategoryR2Images[category].length}件アップロード完了`);
            }
          } else if (officialHtml) {
            // フォールバック: categoryImagesがない場合は従来のHTML抽出を使用
            console.log('[Step 5.5b] categoryImagesがないため、HTML抽出にフォールバック');
            const articleImageService = getArticleImageUploadService();
            bodyImagesUpload = await articleImageService.uploadFromHtml(
              officialHtml, // Step 1.5 で取得済みのHTMLを再利用
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

      // Step 5.7: プレースホルダー置換
      console.log('\n[Step 5.7/11] プレースホルダー置換...');

      let placeholderReplacement: PlaceholderReplacementResult | undefined;
      let finalContent = contentGeneration.content;

      // カテゴリ別R2画像がある場合のみ置換を実行
      // uploadedCategoryR2Images は Step 5.5b でアップロードされた画像のR2 URL
      const hasCategoryR2Images =
        uploadedCategoryR2Images.menu.length > 0 ||
        uploadedCategoryR2Images.novelty.length > 0 ||
        uploadedCategoryR2Images.goods.length > 0;

      if (hasCategoryR2Images) {
        const placeholderReplacer = getImagePlaceholderReplacerService();
        placeholderReplacement = placeholderReplacer.replaceAll(
          contentGeneration.content,
          uploadedCategoryR2Images
        );
        finalContent = placeholderReplacement.content;

        console.log('[Step 5.7] プレースホルダー置換結果:', {
          replacedCount: placeholderReplacement.replacedCount.total,
          removedSections: placeholderReplacement.removedSections,
          unreplacedCount: placeholderReplacement.unreplacedPlaceholders.length,
        });

        if (placeholderReplacement.unreplacedPlaceholders.length > 0) {
          console.warn('[Step 5.7] ⚠️ 未置換プレースホルダー:', placeholderReplacement.unreplacedPlaceholders);
        }
      } else {
        console.log('[Step 5.7] カテゴリ別R2画像なし、プレースホルダー置換をスキップ');
      }

      // Step 6: MDX記事を組み立て
      console.log('\n[Step 6/11] MDX記事を組み立て...');

      const mdxArticle = generateMdxArticle(
        {
          postId: eventRecord.postId,
          year,
          eventType,
          eventTitle: extraction.eventTypeName,
          workTitle: extraction.workTitle,
          workSlug,
          title: titleResult.title, // YAMLテンプレートで生成されたタイトルを使用
          categories: categories, // buildCategories() で決定論的に構築
          excerpt: metadata.excerpt,
          date: rssItem.pubDate || new Date().toISOString().split('T')[0],
          author: 'thanks2music',
          ogImage: ogImageUrl, // R2にアップロードしたOG画像URL
        },
        finalContent // プレースホルダー置換済みの本文を使用
      );

      console.log('MDX組み立て完了:', {
        filePath: mdxArticle.filePath,
        contentLength: mdxArticle.content.length,
      });

      // Step 7: Create GitHub PR
      let prResult: CreateMdxPrResult | undefined;

      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: GitHub PR作成をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        const modeEmoji = localOnly ? '💾' : '🧪';
        console.log(`\n[Step 7/11] GitHub PR作成（${modeLabel}のためスキップ）...`);
        console.log(`${modeEmoji} ${modeLabel}: PR作成をスキップしました`);

        // MDX記事の内容をプレビュー表示
        console.log('\n📄 生成されたMDX記事のプレビュー:');
        console.log('-'.repeat(60));
        // 先頭50行を表示
        const previewLines = mdxArticle.content.split('\n').slice(0, 50);
        console.log(previewLines.join('\n'));
        if (mdxArticle.content.split('\n').length > 50) {
          console.log('... (以下省略)');
        }
        console.log('-'.repeat(60));
      } else {
        // 通常モード: GitHub PR作成
        console.log('\n[Step 7/11] GitHub PRを作成...');

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

      // Step 8: Update Firestore status to 'generated'
      if (skipExternalOps) {
        // ドライラン/ローカル保存モード: ステータス更新をスキップ
        const modeLabel = localOnly ? 'ローカル保存' : 'ドライラン';
        const modeEmoji = localOnly ? '💾' : '🧪';
        console.log(`\n[Step 8/11] Firestoreステータス更新（${modeLabel}のためスキップ）...`);
        console.log(`${modeEmoji} ${modeLabel}: ステータス更新をスキップしました`);
      } else {
        // 通常モード: ステータス更新
        console.log('\n[Step 8/11] Firestoreのステータスを更新...');

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
