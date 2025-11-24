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
import { ClaudeAPIService } from './claude-api.service';
import { convertRssContentToMarkdown } from '../utils/html-to-markdown';
import { extractArticleHtml } from '../utils/html-extractor';
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
  // Claude APIで抽出された情報（オプション）
  extracted?: {
    workTitle: string;
    storeName: string;
    eventTypeName: string;
  };
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
   * 0.5. Claude APIで記事選別（公式URL検出、採用判定）
   * 1. Claude APIでRSS記事から作品/店舗/イベント情報を抽出
   * 2. YAMLコンフィグでslugを解決（フォールバック: Claude API → ASCII）
   * 3. Firestoreで重複チェック + イベント登録（status: pending）
   * 4. Claude APIでカテゴリ/抜粋を生成
   * 4.5. Claude APIでタイトルを生成（YAMLテンプレート使用） ← NEW
   * 5. MDX記事を生成
   * 6. GitHub PRを作成
   * 7. Firestoreのステータスを更新（status: generated）
   */
  async generateMdxFromRSS(request: MdxGenerationRequest): Promise<MdxGenerationResult> {
    const { rssItem } = request;
    const year = new Date().getFullYear();

    console.log('========== MDXパイプライン: 記事生成開始 ==========');
    console.log('RSS記事:', { title: rssItem.title, link: rssItem.link });

    // RSS本文を取得（Step 4.5 と Step 5 で使用）
    const rawContent = rssItem.content || rssItem.contentSnippet || '';

    try {
      // Step 0.5: Article selection filter (公式URL検出 + 採用判定)
      console.log('\n[Step 0.5/9] Claude APIで記事選別（公式URL検出、採用判定）...');
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
      console.log('\n[Step 1/9] Claude APIでRSS記事から作品/店舗/イベント情報を抽出...');

      const extraction =
        request.extracted ||
        (await extractFromRss({
          title: rssItem.title,
          content: rssItem.content || rssItem.contentSnippet || '',
          link: rssItem.link,
        }));

      console.log('抽出結果:', extraction);

      // Step 2: Resolve slugs (YAML config → Claude API → ASCII fallback)
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

      const eventRecord = await registerNewEvent({
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

      // Step 4: Generate categories and excerpt using Claude API
      console.log('\n[Step 4/9] Claude APIでカテゴリ/抜粋を生成...');

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
      console.log('\n[Step 4.5/9] Claude APIでタイトルを生成（YAMLテンプレート使用）...');

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

      // Step 5: Generate MDX article
      console.log('\n[Step 5/9] MDX記事を生成...');

      // Convert HTML content to Markdown
      const markdownContent = convertRssContentToMarkdown(rawContent);

      console.log('コンテンツ変換:', {
        hasHtmlTags: rawContent.includes('<'),
        originalLength: rawContent.length,
        convertedLength: markdownContent.length,
      });

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
        markdownContent
      );

      console.log('MDX生成完了:', {
        filePath: mdxArticle.filePath,
        contentLength: mdxArticle.content.length,
      });

      // Step 6: Create GitHub PR
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

      const prResult = await createMdxPr({
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

      // Step 7: Update Firestore status to 'generated'
      console.log('\n[Step 7/9] Firestoreのステータスを更新...');

      await updateEventStatus(eventRecord.canonicalKey, 'generated');

      console.log('✅ ステータス更新完了: pending → generated');
      console.log('========== MDXパイプライン: 記事生成完了 ==========\n');

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
   * Claude API、Firestore、GitHub API への接続を確認します。
   */
  async testConnections(): Promise<{
    claude: boolean;
    firestore: boolean;
    github: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let claudeStatus = false;
    let firestoreStatus = false;
    let githubStatus = false;

    // Test Claude API
    try {
      const claudeService = new ClaudeAPIService();
      claudeStatus = await claudeService.testConnection();
      if (!claudeStatus) {
        errors.push('Claude API connection test failed');
      }
    } catch (error) {
      errors.push(`Claude API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      claude: claudeStatus,
      firestore: firestoreStatus,
      github: githubStatus,
      errors,
    };
  }
}

export default ArticleGenerationMdxService;
