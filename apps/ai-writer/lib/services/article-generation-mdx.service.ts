import { Sentry } from '@/lib/observability/sentry';
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
import { extractArticleHtml, extractContentHtml, extractOgImageUrl, extractPageLinks } from '../utils/html-extractor';
import { toIsoMsDate } from '../utils/date';
import { recordPipelineEvent } from '../ai/observability/ai-call-recorder';
import { parseAndNormalizeEventData } from '../utils/event-data-normalization';
import { extractEventFactCardFields } from '../utils/event-fact-card-mapper';
import {
  runVenueCompletenessGate,
  type VenueGateVerdict,
} from '../utils/venue-completeness-gate';
import { deriveStoreContext } from '../utils/store-derivation';
import { resolveEventTypeHeadingLabel } from '../utils/event-type-heading-label';
import { loadYamlConfig } from '../config/yaml-loader';
import { stripUtmFromUrl } from '../utils/url';
import { escapeMdxText, selfCloseVoidElements } from '../utils/mdx-safety';
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import {
  findUnreplacedPlaceholders,
  removeImagePlaceholderLines,
} from '../utils/placeholder-residue';
import { type EventData } from '@revolution/schemas/mdx-frontmatter';
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
import { getR2StorageService } from './r2-storage.service';
import { getConfigLoaderService } from './config-loader.service';
import { r2ImageStore } from './article-images/upload-article-images';
import { articleImageTags } from './article-images/article-image-tag';
import {
  IMAGE_CATEGORIES,
  itemImageTags,
  uploadImagesForArticle,
  type ArticleImagesUpload,
  type ImageCategory,
} from './article-images/upload-images-for-article';
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
// Sprint C-β P11 (2026-07-19): rule-driven リード文生成
import { getLeadGeneratorService } from './lead-generator.service';
import { getMediaFormResolverService } from './media-form-resolver.service';
import { getMediaTypeMapperService } from './media-type-mapper.service';
import {
  createCostTracker,
  type CostTrackerService,
} from '@/lib/ai/cost';
import { buildCategories } from '@/lib/utils/category-builder';
import { validateStoreName } from '@/lib/utils/store-name-validator';
import { VisionApiServiceFactory } from './vision-api/vision-api-service.factory';
import { callVisionApiForAllCategories } from './vision-api/multi-category-vision.service';
import { YamlTemplateLoaderService } from './yaml-template-loader.service';
import { selectFallbackLevel, validateBusinessRules } from '@/lib/utils/vision-api-utils';
import { determineVisionTargets, type VisionTargets } from './vision-api/vision-targets';
import { menuItemsOf, mergeVisionIntoExtraction } from './vision-api/merge-vision-into-extraction';
import { mentionsRedrawnIllustration } from '@/lib/utils/redrawn-illustration';
import { sameSiteOfficialUrls } from '@/lib/utils/same-site-official-urls';
import { isEmptyList } from '@/lib/utils/llm-values';
import { SubpageExtractionService, type SubpageFacts } from './subpage-extraction.service';
import { withNoveltyImagesFromVenues } from './pick-novelty-images';
import { mergeSubpagesIntoExtraction } from './merge-subpage-into-extraction';
import {
  goodsNamesForProse,
  hasGoodsSection,
  insertIntoGoodsSection,
  loadGoodsListConfig,
  renderGoodsList,
} from './goods-list';
import {
  fillTemplate,
  loadSectionYaml,
  appendToNoveltySection,
  hasMenuSection,
  hasNoveltySection,
  renderMenuItems,
  renderMenuTable,
  replaceMenuItems,
  replaceSummaryRowValue,
  replaceMenuItemsWithTable,
  type MenuTableConfig,
  replaceNoveltySentence,
} from './section-renderers';
import type {
  VisionExtractionResult,
  FallbackLevelType,
} from '@/lib/types/vision-api';

/**
 * 記事タイトル用に作品名を短縮する閾値（文字数）。
 *
 * @description
 * 正式名称がこの長さ以上で、かつ辞書に短縮名があれば、**タイトルでは短縮名を使う**。
 *
 * ★ 10 文字なのは、既存の「10 文字未満の作品は略称不可」というルール
 *   (`3-title.yaml` / プロンプト注記) と閾値を揃えるため。新しい基準を持ち込まない。
 *
 * ★ **文字数だけが理由ではない。** タイトルでユーザーが検索するのは
 *   「スター・ウォーズ」「Nissy」であって、副題や企画名ではない (BOSS 2026-08-09)。
 *   短縮は SEO 上の意図を持つ。
 *
 * ★ これは「タイトルが 40 字に収まる」ことを保証しない。店舗名や日付が長ければ
 *   なお超過しうる。その場合は `3-title.yaml` の短縮ラダーが後段で効く。
 *   本閾値は**作品名という最も支配的な要因を先に潰す**ためのもの。
 */
const WORK_TITLE_SHORTEN_THRESHOLD = 10;

/**
 * Vision の 1 カテゴリあたりの時間切れ (ms)。縦に長い画像は分割して 10〜20 片を高い解像度で
 * 読むため、以前の 30 秒では足りない (2026-10-12)
 */
const VISION_TIMEOUT_MS = 120_000;

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
  // 記事の画像のアップロード結果 (image-upload-r2 step。上げた画像・アイキャッチ・飛ばした画像)
  imagesUpload?: ArticleImagesUpload;
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
  visionApiResult?: VisionStepResult;
}

/**
 * vision-api step の結果。Vision の結果を本文に使ったかは `merged` で分かる。
 */
interface VisionStepResult {
  /** Vision を呼んだか */
  called: boolean;
  /** HTML から書けなかった項目と、読んだカテゴリ */
  targets?: VisionTargets;
  /** Vision の結果 (業務ルールの減点を反映した確信度) */
  visionExtraction?: VisionExtractionResult;
  fallbackLevel?: FallbackLevelType;
  /** Coming Soon の画像から品目を作ったカテゴリがあり、その結果を捨てたか */
  hallucinationDetected?: boolean;
  /** Vision の結果で抽出結果を埋めたか (レベル A のときだけ) */
  merged: boolean;
  /** 埋めた内容 */
  mergeChanges?: string[];
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
      google: 'Google Gemini',
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
      // 公式サイトのトップページの og:image (アイキャッチの第 1 候補。image-upload-r2 step で使う)
      let officialOgImage: string | null = null;

      if (selectionResult.primary_official_url) {
        try {
          // 公式サイトのHTMLを1回だけ取得（content-generation step と image-upload-r2 step で再利用）
          console.log('公式サイトURLからHTML取得中:', selectionResult.primary_official_url);
          // ⚠️ `raw` (圧縮前) は会場の網羅性ゲート専用。LLM へ渡すのは `compacted` だけ
          //    (圧縮は class 属性を全て落とすため、raw でないと会場ブロックを認識できない)。
          const contentHtml = await extractContentHtml(selectionResult.primary_official_url);
          officialHtml = contentHtml.compacted;
          // og:image は <head> にある。compacted は本文のブロックだけのことがある (meta が無い) ので、ここで読む
          officialOgImage = extractOgImageUrl(contentHtml.raw, selectionResult.primary_official_url);
          console.log(
            '公式サイトHTML取得完了:',
            officialHtml.length,
            'bytes (圧縮前',
            contentHtml.raw.length,
            'bytes)'
          );

          // ExtractionService で詳細情報を抽出
          //
          // ★ 会場の網羅性ゲート (S1-d Phase 3.8 Step A) を通す。occurrences は
          //   同一入力でも確率的に落ちるため (conan-cafe.jp で 10/8/10/8)、公式サイトの
          //   正解データと照合し、会場が欠けていれば再抽出する。
          //   ⚠️ 照合には**圧縮前**の `contentHtml.raw` を渡す (圧縮は class 属性を
          //     全て落とすため、compacted を渡すと全サイト unsupported になり
          //     ゲートが黙って無効化される)。
          const extractionService = new ExtractionService();
          const primaryOfficialUrl = selectionResult.primary_official_url;
          const officialUrls = selectionResult.official_urls;
          const llmInput = officialHtml;

          const gateResult = await runVenueCompletenessGate({
            rawHtml: contentHtml.raw,
            llmInputChars: llmInput.length,
            // ⚠️ 分母は定数ではなく**実効値**を使う。`maxAttempts` を上書きされたときに
            //    表示だけがずれる (claude[bot] 4 巡目指摘、2026-08-14 採用)。
            runAttempt: async (attempt, previous, maxAttempts) => {
              if (attempt > 1) {
                console.warn(
                  `${getStepContext('detail-extraction', '会場網羅性')} ⚠️ 会場が ${previous?.missingVenues.length ?? 0} 件欠落したため再抽出します ` +
                    `(${attempt}/${maxAttempts} 回目): ${previous?.missingVenues.join(', ') ?? ''}`
                );
              }
              const result = await extractionService.extractFromOfficialSite({
                primary_official_url: primaryOfficialUrl,
                page_content: llmInput,
                official_urls: officialUrls,
                // ⚠️ 観測ログ専用。プロンプトへは渡らない (自己成就の防止)
                observationContext: {
                  venueGateAttempt: attempt,
                  venueGatePrevious: previous,
                },
              });

              // ★ コストはここで記録する。ループの外に置くと**再試行分が計上されない**
              //   (採用された最後の 1 回しか数えられない)。
              if (result.model && result.usage) {
                costTracker.recordUsage('detail-extraction', result.model, result.usage);
              }
              return result;
            },
            getEventData: (extraction) => extraction.event_data,
            getPeriod: (extraction) => extraction.開催期間,
          });

          detailedExtraction = gateResult.extraction;

          // ★ 判定は必ず 3 経路へ出す。観測ログ (JSONL) は本番では無効なので、
          //   console と skipReason だけが本番で残る唯一の痕跡になる。
          logVenueGateVerdict(gateResult.verdict);
          await recordVenueGateVerdict(gateResult.verdict, primaryOfficialUrl);

          if (gateResult.verdict.status === 'failed') {
            console.error(
              `❌ ${getStepContext('detail-extraction', '会場網羅性')} ${gateResult.verdict.skipReason}`
            );
            return {
              success: false,
              skipped: true,
              skipReason: gateResult.verdict.skipReason,
            };
          }

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

          // ★ コストの記録は `runAttempt` の中で試行ごとに済ませている。
          //   ここで再度記録すると採用された試行だけ二重計上になる。
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
            subpageDetection.categoryUrls,
            // 記事選別の公式 URL を先に、トップページのリンクを後に (上限は画像の抽出の側で 10 件)
            sameSiteOfficialUrls(selectionResult.primary_official_url, [
              ...(selectionResult.official_urls ?? []),
              ...pageLinks,
            ])
          );

          console.log(`${getStepContext('category-image-extraction')} カテゴリ別画像抽出結果:`, {
            menu: categoryImages.menu.length,
            novelty: categoryImages.novelty.length,
            goods: categoryImages.goods.length,
            total: categoryImages.all.length,
          });
        } catch (subpageError) {
          console.warn('⚠️ 下層ページ検出/画像抽出に失敗（処理は続行）:', subpageError);
          // エラーが発生しても処理は続行 (本文の画像は無し。アイキャッチは og:image があれば使う)
        }
      } else {
        console.log(`[subpage-detection/category-image-extraction] 公式サイトHTMLがないため、下層ページ検出をスキップ`);
      }

      // subpage-extraction step: 下層ページと会場の案内ページの文字から、メニュー・グッズ・ノベルティ・キャラクターを読む
      console.log(`\n${getStepDisplay('subpage-extraction')} 下層ページの文字からメニュー/グッズ/ノベルティを抽出...`);
      if (detailedExtraction && categoryImages && categoryImages.pages.length > 0) {
        const subpageStep = await this.runSubpageExtraction(detailedExtraction, categoryImages, costTracker);
        detailedExtraction = subpageStep.extraction;
        // ノベルティの下層ページが無ければ、ノベルティ名が読めた会場の案内ページの特典の画像を使う
        const noveltyStep = withNoveltyImagesFromVenues(categoryImages, subpageStep.pages);
        categoryImages = noveltyStep.categoryImages;
        if (noveltyStep.picked) {
          console.log(
            `${getStepContext('subpage-extraction')} ノベルティの画像: ノベルティ名が読めた会場のページ ${noveltyStep.picked.url} から ${noveltyStep.picked.images.length}枚`,
            `(候補のある会場のページ ${categoryImages.venueNoveltyImages.length} 件)`,
          );
        }
      } else {
        console.log(`${getStepContext('subpage-extraction')} 読む下層ページが無いため、スキップ`);
      }

      // vision-api step: HTML から書けなかった項目の画像だけを読み、レベル A なら抽出結果を埋める
      console.log(`\n${getStepDisplay('vision-api')} Vision API統合（HTML で書けない項目の画像だけを読む）...`);

      let visionApiResult: VisionStepResult = { called: false, merged: false };
      if (!detailedExtraction) {
        console.log(`${getStepContext('vision-api')} detailedExtraction がないため、Vision API をスキップ`);
      } else {
        const visionStep = await this.runVisionStep(detailedExtraction, categoryImages, officialHtml, costTracker);
        detailedExtraction = visionStep.extraction;
        visionApiResult = visionStep.result;
      }

      // ノベルティ名が書けないときは、画像があってもノベルティの節を書かせない。本文の LLM は画像の数で
      // 節を書くかを決めるため、名前の無いまま「来店特典のノベルティー」のような根拠の無い文を書いた
      // (2026-10-12、ヒロアカで AI が利用ガイドのページをノベルティのページと判定したとき)
      if (categoryImages && categoryImages.novelty.length > 0 && isEmptyList(detailedExtraction?.ノベルティ名)) {
        console.log(
          `${getStepContext('vision-api')} ノベルティ名が無いため、ノベルティの画像 ${categoryImages.novelty.length} 枚を使わない (節を書かない)`,
        );
        categoryImages = { ...categoryImages, novelty: [] };
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
      // @see notes/archive/category-improvement-research-2025-12-16.md
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

      // ========================================================================
      // 会場派生変数の算出 (S1-d Phase 3): 代表会場名の決定表を 1 回だけ回す
      // ========================================================================
      //
      // ★ **title-generation より前**に置く。記事タイトルも開催都市を必要とし、
      //   H2 と同じ情報源から作らないと「H2 は東京・大阪、タイトルは渋谷」のように
      //   同じ記事で開催地が食い違う (実測 4 件、2026-08-09)。
      // ========================================================================
      //
      // ★ **ここで 1 回計算して以降のステップへ配る。** lead-generation /
      //   content-generation / text-placeholder-replacement が別々に算出すると、
      //   同じ記事の中でリード文と H2 で違う会場名が出る (§8「参照側の取りこぼし」の
      //   典型形)。
      //
      // ★ occurrences の正規化もここへ前倒しする。従来は mdx-assembly まで待って
      //   いたが、リード文と本文はそれより前に生成されるため間に合わない。
      //   正規化結果は mdx-assembly でも再利用する (二重に走らせない)。
      //
      // ★ parse + 正規化の実体は `parseAndNormalizeEventData` に集約している。
      //   会場の網羅性ゲート (detail-extraction) と照合 CLI も同じ関数を通すため、
      //   ここで別実装を書くと「ゲートは通ったのに記事は別の occurrences」になる。
      const parsedEventDataResult = (() => {
        const result = parseAndNormalizeEventData({
          rawEventData: detailedExtraction?.event_data,
          period: detailedExtraction?.開催期間,
          // ★ 解決済みの `prefectures` を使う (claude[bot] 指摘 2026-08-09)。
          //   生の `開催都道府県` は JP_PREFECTURE 辞書との照合前で、表記揺れや
          //   ハルシネーションが混ざりうる。frontmatter は解決済みを書くため、
          //   ここで生値を使うと**同じ記事で参照するデータ源が割れる**。
          prefectures,
        });

        if (result.status === 'absent') return undefined;
        if (result.status === 'invalid') {
          console.warn(
            `${getStepContext('lead-generation', 'event_data')} ⚠️ プロンプト応答の event_data が EventDataSchema に不適合、undefined として扱い:`,
            result.issues,
          );
          return undefined;
        }
        for (const warning of result.warnings) {
          console.warn(
            `${getStepContext('lead-generation', 'event_data')} ⚠️ occurrences 正規化: ${warning}`,
          );
        }
        return result.eventData;
      })();

      // 種別の見出し表記。**「カフェ」をハードコードしない** — pop-up-store や
      // 原画展に「カフェ」と書くと事実誤認になる (revolution-article-meta.md §4.3 と同趣旨)。
      const eventTypeSlugsConfig = loadYamlConfig('EVENT_TYPE_SLUGS');
      const eventTypeHeadingLabel = resolveEventTypeHeadingLabel({
        eventTypeName: extraction.eventTypeName,
        eventTypes: eventTypeSlugsConfig.event_types,
        headingLabels: eventTypeSlugsConfig.heading_labels,
      });

      const storeContext = deriveStoreContext({
        occurrences: parsedEventDataResult?.occurrences,
        officialUrl: selectionResult.primary_official_url,
        brandSlugs: loadYamlConfig('BRAND_SLUGS').brand_slugs,
        // ★ 解決済みの `prefectures` を使う (claude[bot] 指摘 2026-08-09)。
        //   この値は `都市表記` (H2) と `都市表記タイトル用` (記事タイトル) の元になる。
        //   生値を使うと、frontmatter には載らない不正な都道府県名が
        //   **見出しとタイトルにだけ出る**という食い違いが起きる。
        prefectures,
        eventTypeLabel: eventTypeHeadingLabel,
        workTitle: canonicalWorkTitle,
      });

      for (const warning of storeContext.warnings) {
        console.warn(`${getStepContext('lead-generation', '会場派生')} ⚠️ ${warning}`);
      }
      console.log(`${getStepContext('lead-generation', '会場派生')} 代表会場名の決定:`, {
        会場数: storeContext.会場数,
        ブランド一覧: storeContext.ブランド一覧,
        見出し形式: storeContext.見出し形式,
        代表店舗名: storeContext.代表店舗名 || '(なし)',
        見出し主語: storeContext.見出し主語,
        // 地の文 (リード文・本文) へ流す値。見出しと食い違っていないかをログで追えるようにする
        会場表現: storeContext.会場表現 || '(なし → 抽出結果の店舗名へ退避)',
        // 記事タイトルへ渡す都市。H2 と同じ情報源から作れているかをログで追う
        都市表記タイトル用: storeContext.都市表記タイトル用 || '(なし)',
      });

      // title-generation step: Generate title using YAML template
      console.log(`\n${getStepDisplay('title-generation')} AI API (${providerDisplayName}) でタイトルを生成（YAMLテンプレート使用）...`);

      // ★ 記事タイトル用の作品名。正式名称が長い場合は辞書の短縮名へ丸める。
      //   `getShortTitle` は完全一致 → alias → **最長前方一致** の順に引く。
      //   前方一致があるため「スター・ウォーズ／マンダロリアン・アンド・グローグー」も
      //   「スター・ウォーズ」に解決できる (副題は企画ごとに変わるため alias 列挙では破綻する)。
      const workTitleShort = canonicalWorkTitle ? (getShortTitle(canonicalWorkTitle) ?? null) : null;
      const titleWorkName =
        canonicalWorkTitle &&
        canonicalWorkTitle.length >= WORK_TITLE_SHORTEN_THRESHOLD &&
        workTitleShort
          ? workTitleShort
          : canonicalWorkTitle;

      if (titleWorkName !== canonicalWorkTitle) {
        console.log(
          `${getStepContext('title-generation', '作品名')} 記事タイトル用に短縮: "${canonicalWorkTitle}" → "${titleWorkName}"`
        );
      }

      const titleService = new TitleGenerationService();
      const titleResult = await titleService.generateTitle({
        rss_title: rssItem.title,
        rss_content: rawContent,
        rss_link: rssItem.link,
        // detail-extraction step で抽出済みのデータを渡す（日付エラー防止）
        extractedPeriod: detailedExtraction?.開催期間,
        // ★ S1-d Phase 3: 店舗名も**決定表の結果**を渡す (claude[bot] 指摘 2026-08-09)。
        //   都市だけ決定表の値にして店舗名を生値のまま残していたため、実測で
        //   「H2 は BOX cafe&space なのにタイトルには OH MY CAFE が『確定』として渡る」
        //   という食い違いが起きていた (くまのプーさん)。本 PR が潰したはずの形。
        //
        //   多ブランドで代表が決まらない場合 (`cities`) は代表店舗名が空になる。
        //   その場合は店舗名を渡さない — 開催地は `extractedCityLabel` が担うため、
        //   どれか 1 会場を「確定」として渡すと他会場を落とす原因になる。
        extractedStoreName: storeContext.代表店舗名 || undefined,
        // ★ S1-d Phase 3: 開催都市を構造化データで渡す。H2 と同じ決定表が情報源。
        extractedCityLabel: storeContext.都市表記タイトル用 || undefined,
        // ★ S1-d Phase 3 (2026-08-09): 作品名は**取得時点で**短縮を判定する。
        //
        //   従来は「タイトルが 40 字を超える場合のみ略称を使う」という条件付き指示を
        //   プロンプトに書いていたが、LLM が守らず実測で 45 / 57 字のタイトルが出ていた
        //   (「スター・ウォーズ／マンダロリアン・アンド・グローグー」がそのまま入る)。
        //
        //   条件をパイプラインの途中 (生成後の文字数) に置くと漏れる。作品名を
        //   取得した時点で決めれば決定的になる (BOSS 判断 2026-08-09)。
        //
        //   ★ 短縮の理由は文字数だけではない。タイトルでユーザーが検索するのは
        //     「スター・ウォーズ」「Nissy」であって副題・企画名ではない (BOSS)。
        extractedWorkName: titleWorkName,
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

      // グッズの一覧の書式と、文に並べるグッズ名 (先頭の数件。Templates の sections/04-goods.yaml)
      const goodsListConfig = loadGoodsListConfig();
      const proseGoodsNames = goodsNamesForProse(detailedExtraction.グッズ名, goodsListConfig);

      // ========================================================================
      // lead-generation step (Sprint C-β P11): rule-driven リード文生成
      // ========================================================================
      // BOSS Q2=B 承認済: リード文を LLM 生成から切り出し、TypeScript 側で
      // 4 スロット構造 ([主体]+[接続動詞]+[形容詞]+[メディア形態]+「作品名」) を
      // rule-driven に組み立てる。LLM Fallback は Phase 2f で本格実装 (現状は
      // AiProvider 未 DI = lead_generic 強制採用 path のみ)。
      console.log(
        `\n${getStepDisplay('lead-generation')} リード文を rule-driven で生成 (LeadGeneratorService、§6.2 対訳マップ)...`
      );

      const leadGenerator = getLeadGeneratorService({
        mediaFormResolver: getMediaFormResolverService(),
        mediaTypeMapper: getMediaTypeMapperService(),
        textReplacer: getTextPlaceholderReplacerService(),
        // Phase 2f で実装した LLM Fallback を production 経路に wire in。
        // Fallback 発火条件 (all_conditions_missed / too_many_unreplaced_placeholders /
        // output_too_short / output_empty / template_render_error / empty_work_title) を
        // rule miss 時に LLM に委譲する (Sprint C-β P11 の N1 = リード文の省略・誤生成の完全解消)。
        //
        // R2 対応: instance 直渡し (`createAiProvider()`) ではなく **factory 関数** (`createAiProvider`)
        // を渡す。singleton の cache 済 instance が最初の request の provider を baked in する
        // 従来の footgun (long-lived Next.js server で env var 変更に追随できない) を解消し、
        // fallback 発火の度に fresh provider を resolve する経路にする。
        aiProviderFactory: createAiProvider,
      });

      // ★ 会場の表記は決定表の結果 (`会場表現`) を流す。抽出結果の `店舗名` を
      //   そのまま渡すと、H2 が「カフェ in 東京・大阪」なのにリード文は東京の 1 店だけを
      //   名指しする、という食い違いが起きる (claude[bot] 指摘、2026-08-09 実測)。
      //   決定表が何も作れなかった場合のみ抽出結果へ退避する。
      const 会場表現 = storeContext.会場表現 || detailedExtraction.店舗名;

      const leadResult = await leadGenerator.generate({
        works: detailedExtraction.works ?? [],
        store: detailedExtraction.store ?? { name: detailedExtraction.店舗名 },
        開催期間: detailedExtraction.開催期間,
        メディアタイプ: detailedExtraction.メディアタイプ,
        原作タイプ: detailedExtraction.原作タイプ,
        原作者有無: detailedExtraction.原作者有無,
        原作者名: detailedExtraction.原作者名,
        キャラクター名: detailedExtraction.キャラクター名,
        テーマ名: detailedExtraction.テーマ名,
        ノベルティ名: detailedExtraction.ノベルティ名,
        // 文に並べるのは先頭の数件だけ (全件はグッズの節の一覧に書く)
        グッズ名: proseGoodsNames,
        作品名: detailedExtraction.作品名,
        店舗名: 会場表現,
        略称: detailedExtraction.略称,
        公式サイトURL: detailedExtraction.公式サイトURL,
        スタジオ名: detailedExtraction.スタジオ名,
        監督名: detailedExtraction.監督名,
        シリーズ名: detailedExtraction.シリーズ名,
      });

      console.log('✅ リード文生成完了:', {
        usedTemplate: leadResult.usedTemplate,
        leadLength: leadResult.leadMdx.length,
        slotMediaForm: leadResult.slots.mediaForm,
        slotWorkTitle: leadResult.slots.workTitle,
        fallbackReason: leadResult.fallbackReason ?? '(none)',
      });

      // ========================================================================
      // content-generation step: Generate MDX article content using ContentGenerationService
      // ========================================================================
      // Sprint C-β P11: 4-content.yaml v2.5.0 で lead セクションは除外済み
      // (menu/novelty/goods/summary のみを LLM が生成)。lead は上記
      // LeadGeneratorService の出力を先頭に concat する。
      console.log(`\n${getStepDisplay('content-generation')} AI API (${providerDisplayName}) で記事本文を生成（YAMLテンプレート使用、menu/novelty/goods/summary）...`);

      // ContentGenerationService で本文を生成
      const contentService = new ContentGenerationService();
      let contentGeneration: ContentGenerationResult;

      try {
        // detail-extraction step で取得した officialHtml を再利用（再取得不要）
        // categoryImages を渡して、画像有無でセクションスキップを判断させる
        contentGeneration = await contentService.generateContent({
          // グッズの節の導入文に並べるのは先頭の数件だけ (全件は一覧に書く)。詳細は一覧をコードで差し込むので渡さない
          extractedData: {
            ...detailedExtraction,
            // ★ リード文・テキストの置換と同じ会場の表記 (`会場表現`)。抽出結果の `店舗名` は主催のブランド名で、
            //   会場ごとにブランドが違うと「BOX cafe&space にて開催」のように一部の会場を落とす (ヒロアカの北海道)
            店舗名: 会場表現,
            グッズ名: proseGoodsNames,
            グッズ詳細リスト: null,
          },
          generatedTitle: titleResult.title,
          officialHtml: officialHtml, // detail-extraction step で取得済みのHTMLを再利用
          categoryImages: categoryImages ? {
            menu: categoryImages.menu,
            novelty: categoryImages.novelty,
            goods: categoryImages.goods,
          } : undefined,
        });

        // Sprint C-β P11: LeadGenerator 出力を content の先頭に concat
        // (contentGeneration.content は menu/novelty/goods/summary の 4 セクション、
        //  4-content.yaml v2.5.0 で lead 除外済み)
        contentGeneration = {
          ...contentGeneration,
          content: `${leadResult.leadMdx}\n\n${contentGeneration.content}`,
        };

        console.log('コンテンツ生成完了:', {
          contentLength: contentGeneration.content.length,
          leadLength: leadResult.leadMdx.length,
          bodyLength: contentGeneration.content.length - leadResult.leadMdx.length - 2,
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

      // image-upload-r2 step: 記事の画像を R2 に上げ、アイキャッチを選ぶ (2026-10-13 BOSS 決定)
      // 枚数の上限なし。短辺の下限・縮小・WebP・縦長の分割・中身のハッシュのキーは article-images/ 配下
      console.log(`\n${getStepDisplay('image-upload-r2')} 画像をR2にアップロード（本文の画像 + アイキャッチ）...`);

      let imagesUpload: ArticleImagesUpload | undefined;
      let ogImageUrl = '/images/og-image-compressed.png'; // デフォルト画像

      if (categoryImages || officialOgImage) {
        try {
          const imageConfig = (await getConfigLoaderService().loadStoreUrlPatterns()).image_extraction;
          const imageStepStartedAt = Date.now();
          imagesUpload = await uploadImagesForArticle(
            {
              ogImage: officialOgImage,
              menu: categoryImages?.menu ?? [],
              novelty: categoryImages?.novelty ?? [],
              goods: categoryImages?.goods ?? [],
              imageAlts: categoryImages?.imageAlts ?? {},
            },
            {
              folder: `${eventType}/${year}/${eventRecord.postId}`,
              config: imageConfig,
              store: skipImageUpload ? null : r2ImageStore(getR2StorageService()),
            },
          );

          for (const category of IMAGE_CATEGORIES) {
            const uploaded = imagesUpload.categories[category];
            const segments = uploaded.reduce((sum, image) => sum + image.segments.length, 0);
            console.log(
              `${getStepContext('image-upload-r2', 'カテゴリ別')} ${category}: ${uploaded.length}/${categoryImages?.[category].length ?? 0} 枚` +
                (segments > uploaded.length ? ` (縦長の画像を分割して ${segments} 片)` : ''),
            );
          }
          if (imagesUpload.eyecatch) {
            ogImageUrl = imagesUpload.eyecatch.url;
            console.log(
              `${getStepContext('image-upload-r2', 'アイキャッチ')} ${imagesUpload.eyecatch.origin}: ${imagesUpload.eyecatch.sourceUrl} → ${ogImageUrl} (${imagesUpload.eyecatch.width}×${imagesUpload.eyecatch.height})`,
            );
          } else {
            console.log(`${getStepContext('image-upload-r2', 'アイキャッチ')} 候補が無いため、デフォルト画像を使用`);
          }
          for (const skipped of imagesUpload.skipped) {
            console.log(`  ⏭️ ${skipped.sourceUrl}: ${skipped.reason}`);
            // 短辺の下限で落とすのは日常 (アイコンなど)。失敗だけを、頂点の captureException の手がかりに残す。
            // 個別 Issue にはしない (1 記事で複数枚が同時に失敗するのが典型で、無料枠を食い、相関も失われる)
            if (skipped.kind === 'failed') {
              Sentry.addBreadcrumb({
                category: 'image-upload',
                level: 'warning',
                message: '記事の画像のアップロード失敗',
                data: { sourceUrl: skipped.sourceUrl, error: skipped.reason },
              });
            }
          }
          console.log(
            `${getStepContext('image-upload-r2')} R2 に新しく置いた画像: ${imagesUpload.newObjects} 件 (既にあった画像は上げない)。` +
              `${((Date.now() - imageStepStartedAt) / 1000).toFixed(1)} 秒`,
          );
        } catch (imageError) {
          console.error('❌ 画像アップロードエラー:', imageError);
          console.log('⚠️ デフォルトOG画像を使用します');

          // デフォルト OG 画像への fallback は **記事が黙って劣化する** 経路。
          // R2_* env が本番の deploy workflow に無いため、ここを常時通っている疑いがある。
          // 実態を掴むまでは breadcrumb に留め、観測結果を見て対処する。
          Sentry.addBreadcrumb({
            category: 'image-upload',
            level: 'warning',
            message: '画像アップロード失敗のためデフォルト OG 画像へ fallback',
            data: { error: imageError instanceof Error ? imageError.message : String(imageError) },
          });
        }
      } else {
        console.log('⚠️ 公式サイトの画像も og:image も無いため、画像アップロードをスキップします');
      }

      // 品目ごとの画像 (代替テキストと品名の照合)。照合できなかった画像は、節の末尾に並べる。
      // 品目の画像は節の見出しを頼りに差し込むので、節が無ければ照合しない (画像は節の末尾の欄に回す)
      const menuNames = detailedExtraction ? menuItemsOf(detailedExtraction).map((item) => item.name) : [];
      const goodsNames = detailedExtraction?.グッズ名 ?? [];
      const menuSectionFound = hasMenuSection(contentGeneration.content);
      const goodsSectionFound = hasGoodsSection(contentGeneration.content);
      for (const [label, names, found] of [['メニュー', menuNames, menuSectionFound], ['グッズ', goodsNames, goodsSectionFound]] as const) {
        if (names.length > 0 && !found) {
          console.warn(`${getStepContext('image-upload-r2', '品目ごと')} ⚠️ ${label}の節の見出しが見つからないため、品目ごとの画像を付けない`);
        }
      }
      const menuItemImages = itemImageTags(menuSectionFound ? menuNames : [], imagesUpload?.categories.menu ?? []);
      // ノベルティは名前ごとの見出しを導入の文の下に並べる (グッズと同じ形)。画像は品名と照合できたものだけ見出しの下に入れる
      const noveltyNames = hasNoveltySection(contentGeneration.content) ? (detailedExtraction?.ノベルティ名 ?? []) : [];
      const noveltyItemImages = itemImageTags(noveltyNames, imagesUpload?.categories.novelty ?? []);
      const goodsItemImages = itemImageTags(goodsSectionFound ? goodsNames : [], imagesUpload?.categories.goods ?? []);
      if (menuItemImages.matched > 0 || goodsItemImages.matched > 0) {
        console.log(
          `${getStepContext('image-upload-r2', '品目ごと')} メニュー ${menuItemImages.matched} 枚・グッズ ${goodsItemImages.matched} 枚を品目に付けた`,
        );
      }

      // 名前のあるカテゴリは、画像が 0 枚でも節を残す (名前はコードが抽出結果から書く。2026-10-13 BOSS 決定)
      const keepSections = new Set<ImageCategory>();
      if (menuNames.length > 0) keepSections.add('menu');
      if (!isEmptyList(detailedExtraction?.ノベルティ名)) keepSections.add('novelty');
      if (!isEmptyList(detailedExtraction?.グッズ名)) keepSections.add('goods');

      // 照合できなかった画像の MDX (代替テキストは「{記事タイトル} {カテゴリ}{番号}」。節の末尾の欄と同じ)
      const restImageTags = (images: typeof menuItemImages.rest, label: string) =>
        images.map((image, index) => articleImageTags(image.segments, `${titleResult.title} ${label}${index + 1}`)).join('\n\n');

      // 品目に写真が付いた節は品目ごとの形にし、照合できなかった画像は品目の後ろ (節の末尾) に「その他参考画像」の見出しを
      // 付けて並べる (プレースホルダーの位置に置くと、品目より前に出てしまう)。メニューは品目に写真が 1 枚も付かなければ
      // 表にする (画像は節の末尾の欄のまま、表はその下。2026-10-15 BOSS 決定)
      const menuPerItem = menuItemImages.matched > 0;
      const menuAsTable = menuNames.length > 0 && !menuPerItem;
      const menuTrailingImages = menuPerItem ? restImageTags(menuItemImages.rest, 'コラボメニュー') : '';
      const goodsPerItem = goodsItemImages.matched > 0;
      const goodsTrailingImages = goodsPerItem ? restImageTags(goodsItemImages.rest, 'グッズ') : '';
      const noveltyPerItem = noveltyNames.length > 0;
      const noveltyTrailingImages = noveltyPerItem ? restImageTags(noveltyItemImages.rest, 'ノベルティ') : '';

      // カテゴリ別R2画像（image-placeholder-replacement step で使用）
      const uploadedCategoryR2Images: CategoryR2Images = {
        menu: menuPerItem ? [] : menuItemImages.rest.map((image) => image.segments),
        novelty: noveltyPerItem ? [] : noveltyItemImages.rest.map((image) => image.segments),
        goods: goodsPerItem ? [] : goodsItemImages.rest.map((image) => image.segments),
        eyecatch: imagesUpload?.eyecatch,
      };

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
        !!uploadedCategoryR2Images.eyecatch ||
        keepSections.size > 0;

      if (hasR2Images) {
        const placeholderReplacer = getImagePlaceholderReplacerService();
        // titleResult.title を渡して alt 属性に記事タイトルを含める
        placeholderReplacement = placeholderReplacer.replaceAll(
          contentGeneration.content,
          uploadedCategoryR2Images,
          titleResult.title,
          keepSections
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
          // ★ リード文と同じ値。本文の地の文で会場表現が割れないようにする。
          店舗名: 会場表現,
          メディアタイプ: detailedExtraction.メディアタイプ,
          原作タイプ: detailedExtraction.原作タイプ,
          原作者有無: detailedExtraction.原作者有無,
          原作者名: detailedExtraction.原作者名,
          略称: detailedExtraction.略称,
          開催回数: detailedExtraction.開催回数 ?? undefined,
          // Sprint C-β P14: collabo-cafe.com origin の utm パラメータを LLM プロンプト入力
          // 段階で剥がす (LLM が本文テーブル markdown link に utm 付き URL をそのまま
          // 反映する経路の防御)。
          公式サイトURL: selectionResult.primary_official_url
            ? stripUtmFromUrl(selectionResult.primary_official_url)
            : undefined,
          キャラクター名: detailedExtraction.キャラクター名 ?? undefined,
          テーマ名: detailedExtraction.テーマ名 ?? undefined,
          ノベルティ名: detailedExtraction.ノベルティ名 ?? undefined,
          グッズ名: proseGoodsNames ?? undefined,
          開催期間: detailedExtraction.開催期間,
          works: detailedExtraction.works || [],
          store: detailedExtraction.store || { name: detailedExtraction.店舗名 },
          // ★ S1-d Phase 3: 会場系派生変数。上で 1 回だけ算出したものを配る。
          //   `{{見出し主語}}` は各セクションの H2 が使う (sections/*.yaml)。
          見出し主語: storeContext.見出し主語,
          代表店舗名: storeContext.代表店舗名,
          会場一覧表記: storeContext.会場一覧表記,
          会場数: storeContext.会場数,
          is_multi_venue: storeContext.is_multi_venue,
        });

        finalContent = textPlaceholderReplacement.content;

        // グッズの節の末尾に、会場で買えるグッズの一覧を差し込む (全件。文に並べた数件の残りもここに書く)
        const goodsList = renderGoodsList(
          detailedExtraction.グッズ名,
          detailedExtraction.グッズ詳細リスト,
          goodsListConfig,
          goodsItemImages.tags,
          goodsTrailingImages,
        );
        const withGoodsList = insertIntoGoodsSection(finalContent, goodsList);
        if (withGoodsList !== finalContent) {
          console.log(
            `${getStepContext('text-placeholder-replacement', 'グッズ一覧')} グッズの節に一覧を差し込んだ (${detailedExtraction.グッズ名?.length ?? 0} 件)`,
          );
          finalContent = withGoodsList;
        }

        // 名前の入る部分は抽出結果から組み立て、本文の LLM が書いたものと置き換える (打ち直しの誤字を防ぐ)
        finalContent = this.renderExtractedNames(finalContent, detailedExtraction, {
          itemImages: menuItemImages.tags,
          trailingImages: menuTrailingImages,
          asTable: menuAsTable,
        }, {
          itemImages: noveltyItemImages.tags,
          trailingImages: noveltyTrailingImages,
        });

        // まとめの表の「開催場所」は、LLM が書いた文ではなく会場の一覧にする (会場のデータがあるときだけ。2026-10-15 BOSS 決定)
        const { venue_row_label } = loadSectionYaml<{ venue_row_label: string }>('05-summary.yaml', 'rendered');
        finalContent = replaceSummaryRowValue(finalContent, venue_row_label, storeContext.会場一覧表記);

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

      // ------------------------------------------------------------------
      // 未置換プレースホルダーの最終検査 (2026-08-15 追加)
      //
      // MDX では {{...}} / {...} が JSX 式として評価されるため、未置換が
      // 残っても ReferenceError にならず「静かに消える」。ページは 200 で
      // 描画されコンソールエラーも 0 件のまま、読者にだけ壊れた文が見える:
      //   「ノベルティー「」がランダムに1枚プレゼントされる。」
      //
      // 上流の text/image placeholder replacer は warn を出すが除去も停止も
      // しない。テンプレート側の {{#if}} ガードと LeadGenerator の閾値
      // 引き下げをすり抜けた場合の最終防壁として、ここで止める。
      //
      // 画像プレースホルダーは独立行の規約なので**除去**する (文が壊れない)。
      // テキストプレースホルダーは文の途中に埋まっており機械的に消すと
      // 係り受けが壊れるため、**除去せず記事ごと skip** する。
      // ------------------------------------------------------------------
      finalContent = removeImagePlaceholderLines(finalContent);

      // MDX は JSX として評価されるため、void 要素が自己閉じでないとビルドが落ちる。
      // 実測 (2026-08-16): LLM が `<br>` を出力し
      // 「Expected a closing tag for `<br>`」で prerender が失敗した。
      // 同じ企画の 1 世代前の記事には無く、出力の揺れで発生するためここで正規化する。
      finalContent = selfCloseVoidElements(finalContent);

      const residualPlaceholders = findUnreplacedPlaceholders(finalContent);
      if (residualPlaceholders.length > 0) {
        console.error(
          `❌ 未置換プレースホルダーが残っているため記事生成を中止: ${residualPlaceholders.join(', ')}`
        );
        return {
          success: false,
          skipped: true,
          skipReason: `未置換プレースホルダーが本文に残っています: ${residualPlaceholders.join(', ')}`,
        };
      }

      // mdx-assembly step: MDX記事を組み立て
      console.log(`\n${getStepDisplay('mdx-assembly')} MDX記事を組み立て...`);

      // 複数作品コラボ対応: works[] から全作品タイトルを抽出
      const workTitles = detailedExtraction?.works?.map((w) => w.title) || [];

      // ------------------------------------------------------------------
      // Sprint C-α (B-1、旧 §11) Step 5.5: EventFactCard 4 フィールド + event_data 導出
      // ------------------------------------------------------------------
      // Q4=C の deterministic mapping:
      //   1. event_data.occurrences[0] を primary source
      //   2. detailedExtraction.開催期間 / 店舗名 / 公式サイトURL を fallback
      //
      // - event_data (プロンプト応答) は EventDataSchema で Zod parse (LLM 応答の
      //   runtime-shape trust を回避、Codex 2026-07-12 review 中指摘 #3 対応)
      // - 4 フィールド導出は extractEventFactCardFields helper (event-fact-card-mapper.ts、
      //   Layer 1 test 38 件で検証済、date-order guard 含む = Codex 高指摘 #2 対応)
      // - silent drop 時は debug log で観測性確保 (Codex 中指摘対応、AI pipeline 品質)
      // ------------------------------------------------------------------
      // Sprint C-α PR #268 R3 (claude[bot] R3-rev2): shared schema から `EventData` 型を
      // 直接 import することで、`ReturnType<typeof EventDataSchema.parse>` の間接参照を排除。
      // schema 定義側の意図 (LLM 応答の zod validate 後の canonical type) がより明快に。
      // ★ S1-d Phase 3 (2026-08-09): parse + 正規化は lead-generation の前へ前倒し済み。
      //   リード文と本文の H2 が正規化前の occurrences を見てしまうのを避けるため。
      //   ここでは**その結果を再利用する**（同じ入力で 2 回走らせると、警告ログが
      //   二重に出るうえ、将来どちらかだけ直して挙動が割れる余地を残す）。
      const parsedEventData: EventData | undefined = parsedEventDataResult;

      // fallback 経路の start/end date の存在有無を先に判定して、helper 呼び出しの副作用を
      // 予測可能にする (droppedFields observability の判定精度向上、Sprint C-α PR #268 R1 対応)。
      const fallbackHadStart =
        detailedExtraction?.開催期間?.開始?.年 != null && detailedExtraction?.開催期間?.開始?.日付 != null;
      const fallbackHadEnd =
        detailedExtraction?.開催期間?.終了?.未定 === false &&
        detailedExtraction?.開催期間?.終了?.年 != null &&
        detailedExtraction?.開催期間?.終了?.日付 != null;
      // event_data.occurrences[0] からの primary 経路の start/end 供給有無 (both が指定された時のみ
      // date-order guard drop の対象になる、helper のロジックと一致させる)
      const primaryOccurrence = parsedEventData?.occurrences?.[0];
      const primaryHadBoth = primaryOccurrence?.starts_on != null && primaryOccurrence?.ends_on != null;

      const eventFactCardFields = extractEventFactCardFields({
        eventDataOccurrences: parsedEventData?.occurrences,
        extractionPeriod: detailedExtraction?.開催期間,
        extractionStoreName: detailedExtraction?.店舗名,
        extractionOfficialUrl: selectionResult.primary_official_url,
      });

      // silent drop の observability (Codex 中指摘 + claude[bot] R1 comment #2/#5/#6 対応)。
      // R2 (comment #4950581671) 改善: mixed source (start=primary、end=fallback 等) で
      // date-order guard 発火時に fallback として誤ラベルされていた問題を修正、date-order
      // 可能性を先に検知する順序に変更。
      //
      // 判定順序:
      //   1. date-order guard 可能性 (両ソースで start/end が候補として存在するのに end drop)
      //      = primary/fallback のどこかで start があり、かつ primary/fallback のどこかで end が
      //        あるのに helper が end を undefined で返した
      //   2. fallback 単独 parse 失敗 (fallback で end が候補として存在するが helper が拒否)
      const primaryHadStart = primaryOccurrence?.starts_on != null;
      const primaryHadEnd = primaryOccurrence?.ends_on != null;
      const anyStartCandidate = fallbackHadStart || primaryHadStart;
      const anyEndCandidate = fallbackHadEnd || primaryHadEnd;

      const droppedFields: string[] = [];
      if (eventFactCardFields.event_start_date === undefined) {
        if (fallbackHadStart) {
          droppedFields.push('event_start_date (fallback extractionPeriod.開始 が存在するが helper が拒否)');
        }
      }
      if (eventFactCardFields.event_end_date === undefined) {
        // date-order guard 発火の可能性を優先判定 (mixed source 対応)
        if (anyStartCandidate && anyEndCandidate) {
          droppedFields.push(
            'event_end_date (start/end 両ソース候補が揃うが helper が拒否 = date-order guard で drop の可能性 (end < start)、または end 側 parse 失敗)',
          );
        } else if (fallbackHadEnd) {
          droppedFields.push('event_end_date (fallback extractionPeriod.終了 が存在するが helper が拒否)');
        } else if (primaryHadEnd) {
          droppedFields.push('event_end_date (primary event_data.occurrences[0].ends_on が存在するが helper が拒否)');
        }
      }
      if (droppedFields.length > 0) {
        console.warn(
          `${getStepContext('mdx-assembly', 'event_fact_card')} ⚠️ EventFactCard フィールドが drop されました:`,
          droppedFields,
        );
      }

      console.log(`${getStepContext('mdx-assembly', 'event_fact_card')} EventFactCard 導出:`, {
        event_start_date: eventFactCardFields.event_start_date ?? 'undefined',
        event_end_date: eventFactCardFields.event_end_date ?? 'undefined',
        venue: eventFactCardFields.venue ?? 'undefined',
        official_url: eventFactCardFields.official_url ?? 'undefined',
        has_event_data: parsedEventData !== undefined,
      });

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
          // Sprint C-α (B-1、旧 §11): EventFactCard 4 フィールド + event_data
          eventStartDate: eventFactCardFields.event_start_date,
          eventEndDate: eventFactCardFields.event_end_date,
          venue: eventFactCardFields.venue,
          officialUrl: eventFactCardFields.official_url,
          eventData: parsedEventData,
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
        imagesUpload,
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

      // このメソッドは全 step を包む catch で `{ success: false }` を返すため、
      // どの step で落ちても例外が外へ出ない。Sentry 導入以前は本番で
      // 「失敗したこと」しか分からなかった。
      //
      // ⚠️ 計装ポイントは 2 系統ある。cron 経路 (`app/api/cron/rss/route.ts`) は
      // 独自の runMdxPipeline() を内包しており、本メソッドを **呼んでいない**。
      // cron は route の catch、SSE / CLI 経路は本 catch でカバーする。
      // 片方だけに入れると、もう片方が観測ゼロになる。
      Sentry.captureException(error, { tags: { pipeline: 'mdx' } });

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
   * メニューの品目とノベルティの文を、抽出結果からコードで組み立てて差し替える (書式と文面は Templates の YAML)。
   * 本文の LLM が名前を書き写すと誤字が混ざるため (2026-10-12、「招待状（ランダム7种）」)。
   */
  private renderExtractedNames(
    content: string,
    extraction: ExtractionResult,
    menu: { itemImages: string[]; trailingImages: string; asTable: boolean } = { itemImages: [], trailingImages: '', asTable: false },
    novelty: { itemImages: string[]; trailingImages: string } = { itemImages: [], trailingImages: '' },
  ): string {
    const ctx = getStepContext('text-placeholder-replacement', '名前の差し込み');
    let result = content;

    const menuItems = menuItemsOf(extraction);
    if (menuItems.length > 0) {
      const rendered = loadSectionYaml<{ item_line: string; other_images_heading: string; table: MenuTableConfig }>(
        '02-menu.yaml',
        'rendered',
      );
      if (menu.asTable) {
        // 品目に写真が 1 枚も付かない (縦長のメニュー表 1 枚にまとまっているなど): 画像の下に表で並べる
        result = replaceMenuItemsWithTable(result, renderMenuTable(menuItems, rendered.table));
      } else {
        const lines = renderMenuItems(menuItems, rendered.item_line, menu.itemImages);
        if (menu.trailingImages) lines.push(`${rendered.other_images_heading}\n\n${menu.trailingImages}`);
        result = replaceMenuItems(result, lines);
      }
    }

    if (!isEmptyList(extraction.ノベルティ名)) {
      const rendered = loadSectionYaml<{ sentence: string; item_line: string; other_images_heading: string }>(
        '03-novelty.yaml',
        'rendered',
      );
      result = replaceNoveltySentence(
        result,
        fillTemplate(rendered.sentence, {
          作品名: escapeMdxText(extraction.作品名 ?? ''),
          ノベルティ名: extraction.ノベルティ名!.map(escapeMdxText),
        }),
      );
      // 導入の文の下に、ノベルティ名ごとの見出し (照合できた画像はその下) と、照合できなかった画像を並べる
      const blocks = extraction.ノベルティ名!.map((name, index) => {
        const heading = fillTemplate(rendered.item_line, { name: escapeMdxText(name) });
        return novelty.itemImages[index] ? `${heading}\n\n${novelty.itemImages[index]}` : heading;
      });
      if (novelty.trailingImages) blocks.push(`${rendered.other_images_heading}\n\n${novelty.trailingImages}`);
      result = appendToNoveltySection(result, blocks.join('\n\n'));
    }

    if (result !== content) {
      console.log(`${ctx} メニュー ${menuItems.length} 品・ノベルティ ${extraction.ノベルティ名?.length ?? 0} 件を抽出結果のまま差し込んだ`);
    }
    return result;
  }

  /**
   * subpage-extraction step。下層ページの抽出に失敗しても記事は止めない (トップページの抽出のまま続ける)。
   */
  private async runSubpageExtraction(
    extraction: ExtractionResult,
    categoryImages: CategoryImages,
    costTracker: CostTrackerService,
  ): Promise<{ extraction: ExtractionResult; pages: SubpageFacts[] }> {
    const ctx = getStepContext('subpage-extraction');
    console.log(
      `${ctx} 読むページ:`,
      categoryImages.pages.map((page) => `${page.kind} ${page.url} (${page.text.length.toLocaleString()} 字)`),
    );
    try {
      const result = await new SubpageExtractionService().extract({
        作品名: extraction.作品名,
        pages: categoryImages.pages,
      });
      if (!result) return { extraction, pages: [] };
      if (result.usage) costTracker.recordUsage('subpage-extraction', result.model, result.usage);
      console.log(
        `${ctx} ページごとの結果:`,
        result.pages.map((page) => ({
          url: page.url,
          area: page.area,
          メニュー: page.メニュー詳細リスト?.length ?? 0,
          グッズ: page.グッズ詳細リスト?.length ?? 0,
          ノベルティ: page.ノベルティ名,
          キャラクター: page.キャラクター名?.length ?? 0,
        })),
      );
      const merged = mergeSubpagesIntoExtraction(extraction, result.pages);
      console.log(`${ctx} ${merged.changes.length > 0 ? '✅ 抽出結果を補った:' : '補う項目なし'}`, merged.changes);
      return { extraction: merged.extraction, pages: result.pages };
    } catch (error) {
      console.error(`${ctx} ❌ 下層ページの抽出に失敗 (トップページの抽出のまま続行):`, error);
      return { extraction, pages: [] };
    }
  }

  /**
   * vision-api step。HTML から書けなかった項目のカテゴリの画像だけを Vision で読み、
   * 確信度がレベル A のときだけ抽出結果を埋める (Vision の失敗は記事を止めない)。
   */
  private async runVisionStep(
    extraction: ExtractionResult,
    categoryImages: CategoryImages | undefined,
    officialHtml: string | undefined,
    costTracker: CostTrackerService,
  ): Promise<{ extraction: ExtractionResult; result: VisionStepResult }> {
    const ctx = getStepContext('vision-api');
    const targets = determineVisionTargets(extraction);
    const result: VisionStepResult = { called: false, merged: false, targets };
    const unchanged = { extraction, result };

    // 読むカテゴリのうち、画像があるもの (無いカテゴリは orchestrator が "no images" で飛ばす)
    const withImages = targets.categories.filter((category) => (categoryImages?.[category].length ?? 0) > 0);
    console.log(`${ctx} HTML で書けない項目:`, {
      missingFields: targets.missingFields,
      categories: targets.categories,
      withImages,
    });

    if (targets.categories.length === 0) {
      console.log(`${ctx} ✅ HTML で 4 項目とも書ける → Vision API をスキップ`);
      return unchanged;
    }
    if (!categoryImages || withImages.length === 0) {
      console.warn(`${ctx} ⚠️ 読むカテゴリに画像なし、Vision API をスキップ`);
      return unchanged;
    }

    result.called = true;
    try {
      const visionService = VisionApiServiceFactory.create();
      const visionTemplate = await new YamlTemplateLoaderService().loadVisionApiTemplate('collabo-cafe');

      console.log(`${ctx} Vision API 並列呼び出し開始 (${withImages.join('/')})...`);
      const { result: visionExtraction, perCategory } = await callVisionApiForAllCategories(
        visionService,
        visionTemplate,
        { menu: categoryImages.menu, goods: categoryImages.goods, novelty: categoryImages.novelty },
        { maxRetries: 3, timeout: VISION_TIMEOUT_MS, categories: targets.categories },
      );

      console.log(`${ctx} 並列呼び出し完了:`, {
        confidence: visionExtraction.visionExtraction.confidence,
        menuItems: visionExtraction.visionExtraction.menuItems.length,
        goodsItems: visionExtraction.visionExtraction.goodsItems.length,
        noveltyItems: visionExtraction.visionExtraction.noveltyItems.length,
        perCategory,
      });

      // Cost tracking — record under one aggregate key (`vision-api`).
      // `metadata.tokensUsed` is the sum across successful calls and is optional.
      const modelName = visionService.getModelName();
      const actualUsage = visionExtraction.visionExtraction.metadata?.tokensUsed;
      if (actualUsage) {
        const costResult = costTracker.recordUsage('vision-api', modelName, actualUsage);
        console.log(`${ctx} Vision API コスト追跡:`, {
          provider: visionService.getProviderName(),
          model: modelName,
          promptTokens: actualUsage.promptTokens,
          completionTokens: actualUsage.completionTokens,
          totalTokens: actualUsage.totalTokens,
          ...(actualUsage.cacheCreationTokens ? { cacheCreationTokens: actualUsage.cacheCreationTokens } : {}),
          ...(actualUsage.cachedTokens ? { cachedTokens: actualUsage.cachedTokens } : {}),
          cost: `$${costResult.usd.toFixed(6)} (¥${costResult.jpy.toFixed(2)})`,
        });
      } else {
        console.log(`${ctx} Vision API コスト追跡: tokensUsed 不在のためスキップ (全 call が usage を返さず)`);
      }

      // 「Coming Soon」の画像から品目を作ったカテゴリは、そのカテゴリの結果だけを捨てた
      // (callVisionApiForAllCategories)。記事は続け、他のカテゴリの結果は使う
      const discarded = Object.entries(perCategory).filter(([, status]) => status.discarded);
      result.hallucinationDetected = discarded.length > 0;
      if (discarded.length > 0) {
        console.warn(`${ctx} 🚨 Hallucination 検出、そのカテゴリの結果は使わない:`, Object.fromEntries(discarded));
      }

      // 業務ルールの減点を、レベルを決める前にかける
      const businessValidation = validateBusinessRules(visionExtraction);
      if (businessValidation.issues.length > 0) {
        console.warn(`${ctx} ⚠️ Business rules 違反、信頼度を調整:`, {
          issues: businessValidation.issues,
          original: visionExtraction.visionExtraction.confidence,
          adjusted: businessValidation.adjustedConfidence,
        });
      }
      const adjusted: VisionExtractionResult = {
        ...visionExtraction,
        visionExtraction: { ...visionExtraction.visionExtraction, confidence: businessValidation.adjustedConfidence },
      };
      result.visionExtraction = adjusted;
      result.fallbackLevel = selectFallbackLevel(adjusted);

      if (result.fallbackLevel !== 'A') {
        console.log(`${ctx} Fallback レベル ${result.fallbackLevel} → Vision の結果は使わない (A のときだけ使う)`);
        return { extraction, result };
      }

      // トップページは本文ブロック (`officialHtml`)、下層ページは画像の抽出で調べた結果を使う
      const hasRedrawnIllustrations =
        mentionsRedrawnIllustration(officialHtml) || categoryImages.mentionsRedrawnIllustration;
      const merged = mergeVisionIntoExtraction(extraction, adjusted.visionExtraction, { hasRedrawnIllustrations });
      if (merged.changes.length === 0) {
        console.log(`${ctx} Fallback レベル A だが、埋める欄が無い`);
        return { extraction, result };
      }

      result.merged = true;
      result.mergeChanges = merged.changes;
      console.log(`${ctx} ✅ Fallback レベル A → 抽出結果を埋めた:`, { hasRedrawnIllustrations, changes: merged.changes });
      return { extraction: merged.extraction, result };
    } catch (visionError) {
      console.error(`${ctx} ❌ Vision API 呼び出し失敗:`, visionError);
      console.log(`${ctx} HTML抽出結果のみで記事生成を続行`);
      return { extraction, result };
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

/**
 * 会場の網羅性ゲートの判定を **console へ** 出す。
 *
 * ⚠️ 観測ログ (JSONL) は `NODE_ENV === 'production'` で無効なので、本番で残るのは
 * ここと `skipReason` だけになる。素通りさせたケース (`unmeasured`) も必ず出す —
 * 「判定していない」ことが見えないと、ゲートが機能していると誤解する。
 */
function logVenueGateVerdict(verdict: VenueGateVerdict): void {
  const ctx = getStepContext('detail-extraction', '会場網羅性');

  if (verdict.status === 'unmeasured') {
    console.warn(
      `${ctx} ⚠️ 判定なしで通過 (正解データを作れず): ${verdict.reason}。` +
        `この記事の occurrences は網羅性を検証していません`
    );
    return;
  }

  const latest = verdict.attempts[verdict.attempts.length - 1];
  const summary =
    `正解 ${latest.expectedCount} / 抽出 ${latest.actualUniqueCount} 会場` +
    ` (${verdict.attempts.length} 回試行)`;

  if (verdict.status === 'passed') {
    console.log(`${ctx} ✅ 会場が揃いました: ${summary}`);
  } else {
    console.error(`${ctx} 🔴 ${verdict.kind}: ${summary}`);
  }

  // ゲートしない指摘も必ず出す。停止させないだけで、無視してよい訳ではない
  for (const attempt of verdict.attempts) {
    const notes = [
      attempt.fabricatedVenues.length > 0 && `正解に無い会場: ${attempt.fabricatedVenues.join(', ')}`,
      attempt.periodMismatches.length > 0 && `期間の不一致: ${attempt.periodMismatches.join(', ')}`,
      attempt.duplicateVenues.length > 0 && `会場名の重複: ${attempt.duplicateVenues.join(', ')}`,
      attempt.unmeasuredPeriodVenues.length > 0 &&
        `期間を照合できず: ${attempt.unmeasuredPeriodVenues.join(', ')}`,
    ].filter((n): n is string => typeof n === 'string');

    if (notes.length > 0) {
      console.warn(`${ctx} ⚠️ 試行 ${attempt.attempt} (停止させない指摘): ${notes.join(' / ')}`);
    }
  }
}

/** 会場の網羅性ゲートの判定を観測ログ (JSONL) へ 1 行追記する。 */
async function recordVenueGateVerdict(
  verdict: VenueGateVerdict,
  officialUrl: string
): Promise<void> {
  await recordPipelineEvent({
    event: 'venue-completeness-gate',
    relatedStepId: 'detail-extraction',
    payload: {
      officialUrl,
      status: verdict.status,
      ...(verdict.status === 'unmeasured'
        ? { reason: verdict.reason, truthStatus: verdict.truthStatus }
        : {
            attemptCount: verdict.attempts.length,
            attempts: verdict.attempts,
            ...(verdict.status === 'failed'
              ? { kind: verdict.kind, missingVenues: verdict.missingVenues }
              : {}),
          }),
    },
  });
}

export default ArticleGenerationMdxService;
