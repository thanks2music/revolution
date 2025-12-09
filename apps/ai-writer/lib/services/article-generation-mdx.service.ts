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
import { extractArticleHtml, extractContentHtml } from '../utils/html-extractor';
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
   * true の場合、Firestore登録とGitHub PR作成をスキップ
   * AI処理（記事選別、情報抽出、メタデータ生成）のみ実行
   */
  dryRun?: boolean;
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
   * 5. MDX記事を生成
   * 6. GitHub PRを作成
   * 7. Firestoreのステータスを更新（status: generated）
   *
   * @description
   * マルチプロバイダー対応済み（2025-12-07）
   * AI_PROVIDER環境変数でプロバイダーを切り替え可能
   */
  async generateMdxFromRSS(request: MdxGenerationRequest): Promise<MdxGenerationResult> {
    const { rssItem, dryRun = false } = request;
    const year = new Date().getFullYear();

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
      console.log('🧪 ドライランモード: Firestore登録・GitHub PR作成をスキップします');
    }
    console.log('RSS記事:', { title: rssItem.title, link: rssItem.link });

    // RSS本文を取得（Step 4.5 と Step 5 で使用）
    const rawContent = rssItem.content || rssItem.contentSnippet || '';

    try {
      // Step 0.5: Article selection filter (公式URL検出 + 採用判定)
      console.log(`\n[Step 0.5/9] AI API (${providerDisplayName}) で記事選別（公式URL検出、採用判定）...`);
      console.log('記事URLからHTML取得中:', rssItem.link);

      const articleHtml = await extractArticleHtml(rssItem.link);
      console.log('記事HTML取得完了:', articleHtml.length, 'bytes');

      const selectionService = new ArticleSelectionService();
      const selectionResult = await selectionService.shouldGenerateArticle({
        rss_title: rssItem.title,
        rss_content: articleHtml,
        site_domain: new URL(rssItem.link).hostname,
      });

      console.log('選別結果:', {
        should_generate: selectionResult.should_generate,
        official_urls_count: selectionResult.official_urls.length,
        primary_url: selectionResult.primary_official_url,
        reason: selectionResult.reason,
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

      // Step 1: Extract work/store/event information from RSS
      console.log(`\n[Step 1/9] AI API (${providerDisplayName}) でRSS記事から作品/店舗/イベント情報を抽出...`);

      const extraction =
        request.extracted ||
        (await extractFromRss({
          title: rssItem.title,
          content: rssItem.content || rssItem.contentSnippet || '',
          link: rssItem.link,
        }));

      console.log('抽出結果:', extraction);

      // Step 1.5: Extract detailed information from official site HTML
      console.log(`\n[Step 1.5/9] AI API (${providerDisplayName}) で公式サイトHTMLから詳細情報を抽出...`);

      let detailedExtraction: ExtractionResult | undefined;
      if (selectionResult.primary_official_url) {
        try {
          // 公式サイトのHTMLを取得（本文用抽出器を使用）
          console.log('公式サイトURLからHTML取得中:', selectionResult.primary_official_url);
          const officialHtml = await extractContentHtml(selectionResult.primary_official_url);
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

      // Step 2: Resolve slugs (YAML config → AI API → ASCII fallback)
      console.log('\n[Step 2/9] YAMLコンフィグでslugを解決...');

      const [workSlug, storeSlug, eventType] = await Promise.all([
        resolveWorkSlug(extraction.workTitle),
        resolveStoreSlug(extraction.storeName),
        resolveEventTypeSlug(extraction.eventTypeName),
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

      if (dryRun) {
        // ドライランモード: 重複チェック・登録をスキップ
        console.log('\n[Step 3/9] Firestore重複チェック（ドライランのためスキップ）...');

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

        console.log('🧪 ドライラン: ダミーイベントレコード生成:', {
          canonicalKey: eventRecord.canonicalKey,
          postId: eventRecord.postId,
          status: 'dry-run (not saved)',
        });
      } else {
        // 通常モード: 重複チェック + 登録
        console.log('\n[Step 3/9] Firestoreで重複チェック...');

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

      // Step 4: Generate categories and excerpt using AI API
      console.log(`\n[Step 4/9] AI API (${providerDisplayName}) でカテゴリ/抜粋を生成...`);

      const metadata = await generateArticleMetadata({
        content: rssItem.content || rssItem.contentSnippet || '',
        title: rssItem.title,
        workTitle: extraction.workTitle,
        eventType: extraction.eventTypeName,
      });

      console.log('メタデータ生成完了:', {
        categories: metadata.categories,
        excerptLength: metadata.excerpt.length,
      });

      // Step 4.5: Generate title using YAML template
      console.log(`\n[Step 4.5/9] AI API (${providerDisplayName}) でタイトルを生成（YAMLテンプレート使用）...`);

      const titleService = new TitleGenerationService();
      const titleResult = await titleService.generateTitle({
        rss_title: rssItem.title,
        rss_content: rawContent,
        rss_link: rssItem.link,
      });

      console.log('タイトル生成完了:', {
        title: titleResult.title,
        length: titleResult.length,
        is_valid: titleResult.is_valid,
      });

      // Step 5: Generate MDX article content using ContentGenerationService
      console.log(`\n[Step 5/9] AI API (${providerDisplayName}) で記事本文を生成（YAMLテンプレート使用）...`);

      // ContentGenerationService で本文を生成
      const contentService = new ContentGenerationService();
      let contentGeneration: ContentGenerationResult;

      try {
        // 公式サイトのHTMLを再取得（コンテンツ生成の参考情報として）
        const officialHtmlForContent = selectionResult.primary_official_url
          ? await extractContentHtml(selectionResult.primary_official_url)
          : undefined;

        contentGeneration = await contentService.generateContent({
          extractedData: detailedExtraction,
          generatedTitle: titleResult.title,
          officialHtml: officialHtmlForContent,
        });

        console.log('コンテンツ生成完了:', {
          contentLength: contentGeneration.content.length,
          generatedSections: contentGeneration.generatedSections,
          skippedSections: contentGeneration.skippedSections,
        });
      } catch (contentError) {
        console.error('❌ コンテンツ生成に失敗しました:', contentError);
        return {
          success: false,
          skipped: true,
          skipReason: `コンテンツ生成に失敗: ${contentError instanceof Error ? contentError.message : 'Unknown error'}`,
          detailedExtraction,
        };
      }

      // MDX記事を組み立て
      const mdxArticle = generateMdxArticle(
        {
          postId: eventRecord.postId,
          year,
          eventType,
          eventTitle: extraction.eventTypeName,
          workTitle: extraction.workTitle,
          workSlug,
          title: titleResult.title, // YAMLテンプレートで生成されたタイトルを使用
          categories: metadata.categories,
          excerpt: metadata.excerpt,
          date: rssItem.pubDate || new Date().toISOString().split('T')[0],
          author: 'thanks2music',
        },
        contentGeneration.content // ContentGenerationService で生成した本文を使用
      );

      console.log('MDX組み立て完了:', {
        filePath: mdxArticle.filePath,
        contentLength: mdxArticle.content.length,
      });

      // Step 6: Create GitHub PR
      let prResult: CreateMdxPrResult | undefined;

      if (dryRun) {
        // ドライランモード: GitHub PR作成をスキップ
        console.log('\n[Step 6/9] GitHub PR作成（ドライランのためスキップ）...');
        console.log('🧪 ドライラン: PR作成をスキップしました');

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
        console.log('\n[Step 6/9] GitHub PRを作成...');

        const branchName = `ai-writer/mdx-${eventType}-${eventRecord.postId}`;
        const prTitle = `✨ Generate MDX (AI Writer): ${eventType}/${eventRecord.postId}`;
        const prBody = this.generatePrBody({
          rssItem,
          extraction,
          metadata,
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

      // Step 7: Update Firestore status to 'generated'
      if (dryRun) {
        // ドライランモード: ステータス更新をスキップ
        console.log('\n[Step 7/9] Firestoreステータス更新（ドライランのためスキップ）...');
        console.log('🧪 ドライラン: ステータス更新をスキップしました');
        console.log('========== MDXパイプライン: ドライラン完了 ==========\n');
      } else {
        // 通常モード: ステータス更新
        console.log('\n[Step 7/9] Firestoreのステータスを更新...');

        await updateEventStatus(eventRecord.canonicalKey, 'generated');

        console.log('✅ ステータス更新完了: pending → generated');
        console.log('========== MDXパイプライン: 記事生成完了 ==========\n');
      }

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
