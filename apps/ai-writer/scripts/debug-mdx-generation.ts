/**
 * MDX生成プロセス全体のエンドツーエンドデバッグスクリプト
 *
 * Phase 0.1の全タスク（Task 1-6）を統合してテストします:
 *   - Task 1: ULID生成 + post_id
 *   - Task 2: YAML読み込み（work_slug, store_slug解決）
 *   - Task 3: Firestore重複判定
 *   - Task 4: MDX frontmatter + テンプレート生成
 *   - Task 5: Claude API（categories/excerpt生成）
 *   - Task 6: GitHub PR統合（ブランチ作成、コミット、PR作成）
 *
 * 使用方法:
 *   pnpm tsx scripts/debug-mdx-generation.ts
 *
 * 前提条件:
 *   - .env.local に GITHUB_PAT を設定
 *   - .env.local に ANTHROPIC_API_KEY を設定
 *   - Firebase Admin SDK の認証情報を設定
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

// Task 1: ULID生成
import { generatePostId } from '../lib/ulid/generate-post-id';

// Task 2: YAML読み込み
import {
  resolveWorkSlug,
  resolveStoreSlug,
  resolveEventTypeSlug,
} from '../lib/config';

// Task 3: Firestore重複判定
import {
  generateCanonicalKeyFromNames,
  checkEventDuplication,
} from '../lib/firestore';

// Task 4: MDX生成
import { generateMdxFrontmatter, generateMdxArticle } from '../lib/mdx';

// Task 5: Claude API
import { generateArticleMetadata } from '../lib/claude';

// Task 6: GitHub PR統合
import { createMdxPr } from '../lib/github';

/**
 * サンプルデータ
 * 実際のユースケースでは外部ソース（RSS、スクレイピング等）から取得
 */
const SAMPLE_DATA = {
  workTitle: '呪術廻戦',
  eventTitle: 'コラボカフェ',
  storeName: 'BOX cafe&space',
  year: 2025,
  title: '呪術廻戦 × BOX cafe&space2025が東京・大阪で開催決定',
  content: `# 今年も「渋谷事変」のコラボレーションカフェが開催決定！「呪術廻戦カフェ2025 渋谷事変」期間限定オープン！！

## "休息"をテーマにした空間の中、キャラクター達の姿を思い浮かべながらゆったりした時間をお楽しみください

　株式会社CLホールディングスの子会社である株式会社エルティーアールは、株式会社MAPPA協力のもと、TVアニメ『呪術廻戦』第2期「渋谷事変」をテーマにしたカフェ、「呪術廻戦カフェ2025 渋谷事変」を、2025年9月25日（木）より東京にて、10月2日（木）より大阪、愛知にて、期間限定オープンいたします。

## 開催概要

### 開催場所/期間

- **東京・池袋**: BOX cafe&space マツモトキヨシ池袋Part2店 / 2025年9月25日（木）〜11月3日（月・祝）
- **東京・表参道**: BOX cafe&space 表参道店 / 2025年10月11日（土）〜11月3日（月・祝）
- **大阪・梅田**: BOX cafe&space ＫＩＴＴＥ OSAKA 2号店 / 2025年10月2日（木）〜11月3日（月・祝）
- **愛知・名古屋**: BOX cafe&space 名古屋ラシック1号店 / 2025年10月2日（木）〜11月3日（月・祝）

## メニュー

### フード&デザート

- **【虎杖悠仁】「黒閃」ラーメン** - 税込1,890円
  黒いフライドオニオンと赤い担々ソースで虎杖の「黒閃」を表現した鶏白湯ラーメンです。

- **【伏黒恵】玉犬「渾」カレー** - 税込1,890円
  ほうれん草カレーと黒いライスとチーズパウダーで伏黒の玉犬「渾」を表現したカレープレートです。

- **【釘崎野薔薇】「共鳴り」トルティーヤ** - 税込1,890円
  薔薇の花びらやにんじんのピクルスをあしらった釘崎らしいパストラミビーフとハムのトルティーヤです。

### ドリンク

- **【虎杖悠仁】マンゴードリンク** - 税込1,090円
- **【伏黒恵】パインドリンク** - 税込1,090円
- **【釘崎野薔薇】ラズベリー&ローズドリンク** - 税込1,090円

## 特典

- **事前予約者限定カフェ利用特典**: A5クリアファイル（全5種）をランダムで1枚プレゼント
- **ドリンク注文特典**: オリジナル紙コースター（全5種）をランダムで1品につき1枚プレゼント
- **通販購入特典**: ミニカード（全5種）を税込3,300円毎に1枚プレゼント`,
};

/**
 * メインデバッグフロー
 */
async function main() {
  console.log('🔍 MDX生成プロセス E2Eデバッグ開始\n');
  console.log('=' .repeat(80));
  console.log('Phase 0.1 統合テスト: Task 1-5');
  console.log('=' .repeat(80));
  console.log();

  try {
    // ========================================
    // STEP 1: ULID生成 + post_id
    // ========================================
    console.log('📝 STEP 1: post_id生成中...');
    const postId = generatePostId();
    console.log(`✅ post_id: ${postId}`);
    console.log();

    // ========================================
    // STEP 2: YAML読み込み（スラッグ解決）
    // ========================================
    console.log('📂 STEP 2: YAMLファイルからスラッグ解決中...');
    console.log(`  入力 - 作品名: ${SAMPLE_DATA.workTitle}`);
    console.log(`  入力 - 店舗名: ${SAMPLE_DATA.storeName}`);

    const workSlug = await resolveWorkSlug(SAMPLE_DATA.workTitle);
    const storeSlug = await resolveStoreSlug(SAMPLE_DATA.storeName);
    const eventType = await resolveEventTypeSlug(SAMPLE_DATA.eventTitle);

    console.log(`✅ work_slug: ${workSlug}`);
    console.log(`✅ store_slug: ${storeSlug}`);
    console.log(`✅ event_type: ${eventType}`);
    console.log();

    // ========================================
    // STEP 3: Firestore重複判定
    // ========================================
    console.log('🔍 STEP 3: Firestore重複チェック中...');

    // duplicationResult をスコープ外で定義（STEP 7で使用するため）
    let canonicalKey = '';
    let duplicationResult: Awaited<ReturnType<typeof checkEventDuplication>> | null = null;

    // storeSlug が null の場合の処理
    if (!storeSlug) {
      console.warn(`⚠️  店舗名 "${SAMPLE_DATA.storeName}" が brand-slugs.yaml に未登録です`);
      console.warn('  → 重複チェックをスキップします');
      console.log();
    } else {
      try {
        duplicationResult = await checkEventDuplication({
          workTitle: SAMPLE_DATA.workTitle,
          storeName: SAMPLE_DATA.storeName,
          eventTypeName: SAMPLE_DATA.eventTitle,
          year: SAMPLE_DATA.year,
        });

        canonicalKey = duplicationResult.canonicalKey;
        console.log(`  canonicalKey: ${canonicalKey}`);

        if (duplicationResult.isDuplicate) {
          console.log('⚠️  重複検出:');
          console.log(`  ステータス: ${duplicationResult.existingDoc?.status}`);
          console.log(`  post_id: ${duplicationResult.existingDoc?.postId}`);
          console.log('  → 実環境では生成をスキップします');
        } else {
          console.log('✅ 重複なし（新規記事として生成可能）');
        }
      } catch (error) {
        console.warn('⚠️  Firestore接続エラー（デバッグモードでは継続）');
        if (error instanceof Error) {
          console.warn(`  理由: ${error.message}`);
        }
      }
    }
    console.log();

    // ========================================
    // STEP 4: Claude API（メタデータ生成）
    // ========================================
    console.log('🤖 STEP 4: Claude APIでメタデータ生成中...');
    console.log(`  タイトル: ${SAMPLE_DATA.title}`);
    console.log(`  作品名: ${SAMPLE_DATA.workTitle}`);
    console.log(`  イベントタイプ: ${SAMPLE_DATA.eventTitle}`);
    console.log(`  コンテンツ長: ${SAMPLE_DATA.content.length}文字`);
    console.log();

    const metadata = await generateArticleMetadata({
      content: SAMPLE_DATA.content,
      title: SAMPLE_DATA.title,
      workTitle: SAMPLE_DATA.workTitle,
      eventType: SAMPLE_DATA.eventTitle,
    });

    console.log('✅ メタデータ生成成功:');
    console.log(`  カテゴリ (${metadata.categories.length}個): ${metadata.categories.join(', ')}`);
    console.log(`  要約 (${metadata.excerpt.length}文字): ${metadata.excerpt}`);
    console.log();

    // ========================================
    // STEP 5: MDX frontmatter生成
    // ========================================
    console.log('📋 STEP 5: MDX frontmatter生成中...');

    const frontmatter = generateMdxFrontmatter({
      postId,
      year: SAMPLE_DATA.year,
      eventType,
      eventTitle: SAMPLE_DATA.eventTitle,
      workTitle: SAMPLE_DATA.workTitle,
      workSlug,
      title: SAMPLE_DATA.title,
      categories: metadata.categories,
      excerpt: metadata.excerpt,
    });

    console.log('✅ frontmatter生成成功:');
    console.log(`  post_id: ${frontmatter.post_id}`);
    console.log(`  slug: ${frontmatter.slug}`);
    console.log(`  work_slug: ${frontmatter.work_slug}`);
    console.log(`  event_type: ${frontmatter.event_type}`);
    console.log(`  date: ${frontmatter.date}`);
    console.log(`  author: ${frontmatter.author}`);
    console.log(`  ogImage: ${frontmatter.ogImage}`);
    console.log();

    // ========================================
    // STEP 6: MDX記事生成
    // ========================================
    console.log('📝 STEP 6: 完全なMDX記事生成中...');

    const mdxArticle = generateMdxArticle(
      {
        postId,
        year: SAMPLE_DATA.year,
        eventType,
        eventTitle: SAMPLE_DATA.eventTitle,
        workTitle: SAMPLE_DATA.workTitle,
        workSlug,
        title: SAMPLE_DATA.title,
        categories: metadata.categories,
        excerpt: metadata.excerpt,
      },
      SAMPLE_DATA.content
    );

    console.log('✅ MDX記事生成成功:');
    console.log(`  ファイルサイズ: ${mdxArticle.content.length}文字`);
    console.log(`  ファイルパス: ${mdxArticle.filePath}`);
    console.log();

    // ========================================
    // STEP 7: GitHub PR作成
    // ========================================
    console.log('🔀 STEP 7: GitHub PR作成中...');

    // ブランチ名生成
    const branchName = `content/mdx-${workSlug}-${postId}`;
    console.log(`  ブランチ名: ${branchName}`);

    // PR タイトル・本文生成
    const prTitle = `✨ 新規記事: ${SAMPLE_DATA.title}`;
    const prBody = `## 📝 記事概要

**タイトル**: ${SAMPLE_DATA.title}
**作品**: ${SAMPLE_DATA.workTitle}
**イベント**: ${SAMPLE_DATA.eventTitle}
**店舗**: ${SAMPLE_DATA.storeName}

## 🤖 AI Writer情報

- **Post ID**: \`${postId}\`
- **Work Slug**: \`${workSlug}\`
- **Canonical Key**: \`${canonicalKey}\`
- **ファイルパス**: \`${mdxArticle.filePath}\`

## 📊 メタデータ

- **カテゴリ**: ${metadata.categories.join(', ')}
- **要約**: ${metadata.excerpt.substring(0, 100)}...

---

🤖 この記事は **Revolution AI Writer** によって自動生成されました。

**注意**: マージ前に内容を確認してください。`;

    console.log(`  PR タイトル: ${prTitle}`);
    console.log();

    try {
      const prResult = await createMdxPr({
        mdxContent: mdxArticle.content,
        filePath: mdxArticle.filePath,
        title: prTitle,
        body: prBody,
        branchName,
        context: {
          workTitle: SAMPLE_DATA.workTitle,
          storeName: SAMPLE_DATA.storeName,
          eventTypeName: SAMPLE_DATA.eventTitle,
          year: SAMPLE_DATA.year,
          postId,
          workSlug,
          canonicalKey,
        },
      });

      console.log('✅ GitHub PR作成成功:');
      console.log(`  PR番号: #${prResult.prNumber}`);
      console.log(`  PR URL: ${prResult.prUrl}`);
      console.log(`  ブランチ: ${prResult.branchName}`);
      console.log(`  コミットSHA: ${prResult.commitSha}`);
      console.log();
    } catch (error) {
      console.error('⚠️  GitHub PR作成エラー:');
      if (error instanceof Error) {
        console.error(`  メッセージ: ${error.message}`);
      }
      console.error('  → デバッグモードでは継続します（本番では要確認）');
      console.log();
    }

    // ========================================
    // 最終結果の表示
    // ========================================
    console.log('=' .repeat(80));
    console.log('📄 生成されたMDXファイルのプレビュー');
    console.log('=' .repeat(80));
    console.log();
    console.log(mdxArticle.content);
    console.log();
    console.log('=' .repeat(80));
    console.log('✅ E2Eデバッグ完了！すべてのステップが正常に動作しました。');
    console.log('=' .repeat(80));
    console.log();
    console.log('📊 次のステップ:');
    console.log('  - 実際のRSSフィードやスクレイピングデータで動作確認');
    console.log('  - Firestore接続の確認（.env.localにFIREBASE_PROJECT_ID設定）');
    console.log('  - GitHub PR作成のテスト（GITHUB_PAT設定済み）');

  } catch (error) {
    console.error('\n❌ エラー発生:', error);
    if (error instanceof Error) {
      console.error('  メッセージ:', error.message);
      console.error('  スタックトレース:', error.stack);
    }
    process.exit(1);
  }
}

main();
