/**
 * URLから直接MDX記事を生成するデバッグスクリプト
 *
 * 既存の debug-mdx-generation.ts と同じパターンで実装:
 * - API Route経由ではなく、直接サービスクラスを呼び出し
 * - 認証不要（.env.local から環境変数を読み込み）
 * - Next.js起動不要（高速実行）
 *
 * 使用方法:
 *   pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html
 *   pnpm debug:mdx --dry-run https://animeanime.jp/article/2025/11/24/94010.html
 *   pnpm debug:mdx --dry-run --log https://animeanime.jp/article/2025/11/24/94010.html
 *   pnpm debug:mdx --local https://animeanime.jp/article/2025/11/24/94010.html
 *   pnpm debug:mdx --upload-images https://animeanime.jp/article/2025/11/24/94010.html
 *
 * オプション:
 *   --dry-run        Firestore登録、GitHub PR作成、画像アップロードをすべてスキップ（AI処理のみ実行）
 *   --log            実行ログをファイルに出力（logs/{日付}-{ドメイン}-{連番}.log）
 *   --local          ローカル環境にMDXファイルを保存（--dry-run を自動的に有効化）
 *                    保存先: apps/ai-writer/content/{eventType}/{workSlug}/{postId}.mdx
 *   --upload-images  画像をR2にアップロードしつつローカル保存（--local + R2アップロード）
 *                    Firestore登録とGitHub PR作成はスキップ
 *
 * 前提条件:
 *   - .env.local に GITHUB_PAT を設定（--dry-run/--local/--upload-images時は不要）
 *   - .env.local に ANTHROPIC_API_KEY を設定
 *   - .env.local に R2_* 環境変数を設定（--upload-images時に必要）
 *   - Firebase Admin SDK の認証情報を設定（--dry-run/--local/--upload-images時は不要）
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { existsSync, createWriteStream, type WriteStream } from 'fs';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

// HTML + タイトル抽出
import { extractArticleData } from '../lib/utils/html-extractor';

// MDX生成サービス
import { ArticleGenerationMdxService } from '../lib/services/article-generation-mdx.service';
import type { MdxGenerationRequest } from '../lib/services/article-generation-mdx.service';

/**
 * コマンドライン引数をパース
 */
function parseArgs(): { url: string; dryRun: boolean; local: boolean; uploadImages: boolean; log: boolean } {
  const args = process.argv.slice(2);
  let dryRun = false;
  let local = false;
  let uploadImages = false;
  let log = false;
  let url = '';

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--local') {
      local = true;
    } else if (arg === '--upload-images') {
      uploadImages = true;
    } else if (arg === '--log') {
      log = true;
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
  }

  // --local は --dry-run を自動的に有効化（Firestore/GitHub操作をスキップ、画像アップロードもスキップ）
  if (local) {
    dryRun = true;
  }

  // --upload-images は local モードを有効化（ファイル保存は実行）、ただし dryRun は false のまま
  // これにより、R2アップロードは実行されるが、Firestore/GitHub操作はスキップされる
  if (uploadImages) {
    local = true;
    dryRun = false; // dryRunをfalseにしてR2アップロードを有効化
  }

  return { url, dryRun, local, uploadImages, log };
}

/**
 * URLからドメイン名を抽出（ログファイル名用）
 * 例: https://prtimes.jp/main/html/... → prtimes-jp
 */
function extractDomainForFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    // ドットをハイフンに変換（例: prtimes.jp → prtimes-jp）
    return urlObj.hostname.replace(/\./g, '-');
  } catch {
    return 'unknown';
  }
}

/**
 * ログファイルパスを生成
 * 形式: logs/{YYYY-MM-DD}-{domain}-{連番}.log
 * 例: logs/2025-12-21-prtimes-jp-01.log
 */
async function generateLogFilePath(url: string): Promise<string> {
  const logsDir = resolve(__dirname, '../logs');

  // logsディレクトリが存在しない場合は作成
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true });
  }

  // 日付とドメイン
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const domain = extractDomainForFilename(url);
  const prefix = `${today}-${domain}`;

  // 既存のログファイルをチェックして連番を決定
  const files = await readdir(logsDir);
  const existingLogs = files.filter(f => f.startsWith(prefix) && f.endsWith('.log'));

  let sequence = 1;
  if (existingLogs.length > 0) {
    // 既存の連番を抽出して最大値+1を使用
    const sequences = existingLogs.map(f => {
      const match = f.match(/-(\d+)\.log$/);
      return match ? parseInt(match[1], 10) : 0;
    });
    sequence = Math.max(...sequences) + 1;
  }

  const sequenceStr = sequence.toString().padStart(2, '0');
  return resolve(logsDir, `${prefix}-${sequenceStr}.log`);
}

/**
 * コンソール出力をファイルにも書き込むようにラップ
 */
function setupConsoleLogging(logFilePath: string): { cleanup: () => void } {
  const logStream: WriteStream = createWriteStream(logFilePath, { flags: 'a' });

  // 元のconsole.logとconsole.errorを保存
  const originalLog = console.log;
  const originalError = console.error;

  // console.logをラップ
  console.log = (...args: unknown[]) => {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    logStream.write(message + '\n');
    originalLog.apply(console, args);
  };

  // console.errorをラップ
  console.error = (...args: unknown[]) => {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    logStream.write('[ERROR] ' + message + '\n');
    originalError.apply(console, args);
  };

  // クリーンアップ関数
  const cleanup = () => {
    console.log = originalLog;
    console.error = originalError;
    logStream.end();
  };

  return { cleanup };
}

/**
 * メインデバッグフロー
 */
async function main() {
  // コマンドライン引数をパース
  const { url, dryRun, local, uploadImages, log } = parseArgs();

  if (!url) {
    console.error('\n❌ エラー: URLが指定されていません\n');
    console.log('使用方法:');
    console.log('  pnpm debug:mdx <URL>');
    console.log('  pnpm debug:mdx --dry-run <URL>');
    console.log('  pnpm debug:mdx --dry-run --log <URL>');
    console.log('  pnpm debug:mdx --local <URL>');
    console.log('  pnpm debug:mdx --upload-images <URL>\n');
    console.log('オプション:');
    console.log('  --dry-run        Firestore登録、GitHub PR作成、画像アップロードをすべてスキップ');
    console.log('  --log            実行ログをファイルに出力（logs/{日付}-{ドメイン}-{連番}.log）');
    console.log('  --local          ローカル環境にMDXファイルを保存（--dry-runを自動有効化）');
    console.log('                   保存先: apps/ai-writer/content/{eventType}/{workSlug}/{postId}.mdx');
    console.log('  --upload-images  画像をR2にアップロードしつつローカル保存');
    console.log('                   Firestore登録とGitHub PR作成はスキップ\n');
    console.log('例:');
    console.log('  pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --dry-run https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --dry-run --log https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --local https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --upload-images https://animeanime.jp/article/2025/11/24/94010.html\n');
    process.exit(1);
  }

  // ログファイル出力のセットアップ
  let logCleanup: (() => void) | undefined;
  let logFilePath: string | undefined;

  if (log) {
    logFilePath = await generateLogFilePath(url);
    const logging = setupConsoleLogging(logFilePath);
    logCleanup = logging.cleanup;
    console.log(`📝 ログファイル: ${logFilePath}`);
  }

  console.log('🔍 URLからMDX記事生成デバッグ開始\n');
  console.log('='.repeat(80));
  if (uploadImages) {
    console.log('🖼️  画像アップロードモード（Firestore/GitHub スキップ + R2アップロード + ファイル保存）');
  } else if (local) {
    console.log('💾 ローカル保存モード（Firestore/GitHub/R2 すべてスキップ + ファイル保存）');
  } else if (dryRun) {
    console.log('🧪 ドライランモード（Firestore/GitHub/R2 すべてスキップ）');
  } else {
    console.log('URL指定デバッグモード');
  }
  console.log('='.repeat(80));
  console.log(`URL: ${url}`);
  if (uploadImages) {
    console.log('モード: --upload-images（R2に画像をアップロード + ローカルにMDXファイルを保存）');
  } else if (local) {
    console.log('モード: --local（ローカルにMDXファイルを保存、画像アップロードなし）');
  } else if (dryRun) {
    console.log('モード: --dry-run（Firestore登録・GitHub PR作成・画像アップロードをスキップ）');
  }
  console.log();

  try {
    // ========================================
    // STEP 1: URLからタイトル + HTMLを抽出
    // ========================================
    console.log('📄 STEP 1: HTMLとタイトルを取得中...');

    const { title, html, actualUrl } = await extractArticleData(url);

    console.log(`✅ タイトル: ${title}`);
    console.log(`✅ HTML: ${html.length} bytes`);
    console.log(`✅ 実際のURL: ${actualUrl}`);
    console.log();

    // ========================================
    // STEP 2: MDX生成（全パイプライン実行）
    // ========================================
    console.log('🤖 STEP 2: MDX記事生成パイプライン実行中...');
    console.log('  → 記事選別（公式URL検出）');
    console.log('  → 作品/店舗/イベント情報抽出');
    if (dryRun || uploadImages) {
      console.log('  → Firestore重複チェック（登録スキップ）');
    } else {
      console.log('  → Firestore重複チェック');
    }
    console.log('  → カテゴリ/抜粋生成');
    console.log('  → タイトル生成');
    if (uploadImages) {
      console.log('  → 画像アップロード（R2にアップロード）');
    } else if (dryRun) {
      console.log('  → 画像アップロード（スキップ）');
    } else {
      console.log('  → 画像アップロード');
    }
    console.log('  → MDX記事生成');
    if (dryRun || uploadImages) {
      console.log('  → GitHub PR作成（スキップ）');
    } else {
      console.log('  → GitHub PR作成');
    }
    console.log();

    const service = new ArticleGenerationMdxService();

    const request: MdxGenerationRequest = {
      rssItem: {
        title,
        link: actualUrl,
        content: html,
        contentSnippet: html.substring(0, 500), // 最初の500文字をスニペットとして使用
        pubDate: new Date().toISOString(),
      },
      dryRun, // ドライランモードをサービスに渡す
      // --upload-images モード: localOnly=true を渡すことで、Firestore/GitHub はスキップしつつ R2 アップロードを実行
      localOnly: uploadImages,
    };

    const result = await service.generateMdxFromRSS(request);

    // ========================================
    // STEP 3: 結果表示
    // ========================================
    console.log();
    console.log('='.repeat(80));
    console.log('📊 生成結果');
    console.log('='.repeat(80));

    if (result.skipped) {
      console.log('\n⚠️  記事生成をスキップしました');
      console.log(`理由: ${result.skipReason}`);
      console.log();
      console.log('='.repeat(80));
      console.log('💡 デバッグヒント:');
      console.log('  - 記事内に公式URLが含まれているか確認してください');
      console.log('  - YAML テンプレートの条件を確認してください');
      console.log('  - DEBUG_HTML_EXTRACTION=true で抽出HTMLを確認できます');
      console.log('='.repeat(80));
      process.exit(0);
    }

    if (!result.success) {
      console.error('\n❌ MDX記事の生成に失敗しました');
      console.error(`エラー: ${result.error}`);
      console.log();
      process.exit(1);
    }

    console.log('\n✅ MDX記事生成成功！');
    console.log();

    // ローカル保存変数（後で結果表示に使用）
    let savedFilePath: string | undefined;

    if (result.mdxArticle) {
      console.log('📝 記事情報:');
      // 生成されたMDXタイトル（frontmatter.title）を表示。RSSタイトルではない。
      console.log(`  タイトル: ${result.mdxArticle.frontmatter?.title || '（タイトル未生成）'}`);
      console.log(`  ファイルパス: ${result.mdxArticle.filePath}`);
      console.log(`  ファイルサイズ: ${result.mdxArticle.content?.length || 0}文字`);
      console.log();

      // --local または --upload-images オプション: ローカルにMDXファイルを保存
      if ((local || uploadImages) && result.mdxArticle.content) {
        console.log('💾 ローカルファイル保存中...');

        // filePath は 'apps/ai-writer/content/...' の形式
        // スクリプトは 'apps/ai-writer/scripts/' にあるので、親ディレクトリに戻って解決
        const absolutePath = resolve(
          __dirname,
          '..',
          result.mdxArticle.filePath.replace('apps/ai-writer/', '')
        );

        // 親ディレクトリを作成（存在しない場合）
        await mkdir(dirname(absolutePath), { recursive: true });

        // MDXファイルを書き込み
        await writeFile(absolutePath, result.mdxArticle.content, 'utf-8');

        savedFilePath = absolutePath;
        console.log(`✅ ローカルに保存しました: ${absolutePath}`);
        console.log();
      }
    }

    if (result.prResult) {
      console.log('🔀 GitHub PR:');
      console.log(`  PR番号: #${result.prResult.prNumber}`);
      console.log(`  PR URL: ${result.prResult.prUrl}`);
      console.log(`  ブランチ: ${result.prResult.branchName}`);
      console.log(`  コミットSHA: ${result.prResult.commitSha}`);
      console.log();
    } else if (uploadImages) {
      console.log('🔀 GitHub PR: （画像アップロードモードのためスキップ）');
      console.log();
    } else if (dryRun) {
      console.log('🔀 GitHub PR: （ドライランのためスキップ）');
      console.log();
    }

    if (result.details) {
      console.log('🏷️  メタデータ:');
      console.log(`  作品スラッグ: ${result.details.workSlug}`);
      console.log(`  店舗スラッグ: ${result.details.storeSlug}`);
      console.log(`  イベントタイプ: ${result.details.eventType}`);
      console.log(`  Post ID: ${result.details.postId}`);
      console.log(`  Canonical Key: ${result.details.canonicalKey}`);
      console.log(`  年: ${result.details.year}`);
      console.log();
    }

    console.log('='.repeat(80));
    if (uploadImages) {
      console.log('✅ 画像アップロード + ローカル保存完了！（Firestore/GitHub操作なし）');
    } else if (local) {
      console.log('✅ ローカル保存完了！（Firestore/GitHub/R2 すべてスキップ）');
    } else if (dryRun) {
      console.log('✅ ドライラン完了！（Firestore/GitHub/R2 すべてスキップ）');
    } else {
      console.log('✅ デバッグ完了！');
    }
    console.log('='.repeat(80));
    console.log();

    if (uploadImages) {
      console.log('📊 画像アップロード + ローカル保存結果:');
      console.log('  - AI処理（記事選別、情報抽出、メタデータ生成）: 完了');
      console.log('  - R2画像アップロード: 完了');
      console.log('  - Firestore登録: スキップ');
      console.log('  - GitHub PR作成: スキップ');
      console.log(`  - ローカル保存: ${savedFilePath ? '完了' : '失敗'}`);
      console.log();
      if (savedFilePath) {
        console.log('💡 次のステップ:');
        console.log(`  1. 保存されたMDXファイルを確認: ${savedFilePath}`);
        console.log('  2. 画像URLが正しくR2のURLになっているか確認');
        console.log('  3. 記事インデックスを再生成: pnpm generate:article-index');
        console.log('  4. 開発サーバーで確認: pnpm dev');
        console.log();
        console.log('💡 本番実行するには --upload-images を外して実行してください:');
        console.log(`  pnpm debug:mdx ${url}`);
        console.log();
      }
    } else if (local) {
      console.log('📊 ローカル保存結果:');
      console.log('  - AI処理（記事選別、情報抽出、メタデータ生成）: 完了');
      console.log('  - R2画像アップロード: スキップ');
      console.log('  - Firestore登録: スキップ');
      console.log('  - GitHub PR作成: スキップ');
      console.log(`  - ローカル保存: ${savedFilePath ? '完了' : '失敗'}`);
      console.log();
      if (savedFilePath) {
        console.log('💡 次のステップ:');
        console.log(`  1. 保存されたMDXファイルを確認: ${savedFilePath}`);
        console.log('  2. 記事インデックスを再生成: pnpm generate:article-index');
        console.log('  3. 開発サーバーで確認: pnpm dev');
        console.log();
        console.log('💡 画像をR2にアップロードしたい場合:');
        console.log(`  pnpm debug:mdx --upload-images ${url}`);
        console.log();
        console.log('💡 本番実行するには --local を外して実行してください:');
        console.log(`  pnpm debug:mdx ${url}`);
        console.log();
      }
    } else if (dryRun) {
      console.log('📊 ドライラン結果:');
      console.log('  - AI処理（記事選別、情報抽出、メタデータ生成）: 完了');
      console.log('  - R2画像アップロード: スキップ');
      console.log('  - Firestore登録: スキップ');
      console.log('  - GitHub PR作成: スキップ');
      console.log();
      console.log('💡 本番実行するには --dry-run を外して実行してください:');
      console.log(`  pnpm debug:mdx ${url}`);
      console.log();
    } else if (result.prResult?.prUrl) {
      console.log('📊 次のステップ:');
      console.log(`  1. PR を確認: ${result.prResult.prUrl}`);
      console.log('  2. 記事内容をレビュー');
      console.log('  3. 問題なければマージ');
      console.log();
    }

    // ログファイルの保存完了メッセージ
    if (logFilePath) {
      console.log('='.repeat(80));
      console.log(`📝 ログファイル保存完了: ${logFilePath}`);
      console.log('='.repeat(80));
    }

    // ログのクリーンアップ
    if (logCleanup) {
      logCleanup();
    }

  } catch (error) {
    console.error('\n❌ エラー発生:', error);
    if (error instanceof Error) {
      console.error('  メッセージ:', error.message);
      console.error('  スタックトレース:', error.stack);
    }
    console.log();
    console.log('='.repeat(80));
    console.log('💡 トラブルシューティング:');
    console.log('  1. URLが正しいか確認');
    console.log('  2. .env.local に必要な環境変数が設定されているか確認');
    console.log('     - ANTHROPIC_API_KEY');
    console.log('     - GITHUB_PAT');
    console.log('     - FIREBASE_PROJECT_ID (オプション)');
    console.log('  3. ネットワーク接続を確認');
    console.log('  4. DEBUG_HTML_EXTRACTION=true でHTML抽出をデバッグ');
    console.log('='.repeat(80));
    console.log();

    // エラー時もログファイルを保存
    if (logFilePath) {
      console.log(`📝 ログファイル保存完了: ${logFilePath}`);
    }

    // ログのクリーンアップ
    if (logCleanup) {
      logCleanup();
    }

    process.exit(1);
  }
}

main();
