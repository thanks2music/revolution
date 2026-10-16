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
 *   pnpm debug:mdx --update 01m4s065g1hchh9d --dry-run
 *   pnpm debug:mdx --update 01m4s065g1hchh9d
 *
 * オプション:
 *   --dry-run        Firestore登録、GitHub PR作成、画像アップロードをすべてスキップ（AI処理のみ実行）
 *   --log            実行ログをファイルに出力（logs/{日付}-{ドメイン}-{連番}.log）
 *                    + AI ステップの観測ログ（logs/{同じ basename}.jsonl と
 *                      logs/prompts/*.txt）。DEBUG_* の設定は不要
 *   --local          ローカル環境にMDXファイルを保存（--dry-run を自動的に有効化）
 *                    保存先: apps/ai-writer/content/{eventType}/{workSlug}/{postId}.mdx
 *   --upload-images  画像をR2にアップロードしつつローカル保存（--local + R2アップロード）
 *                    Firestore登録とGitHub PR作成はスキップ
 *   --update <post_id>
 *                    公開中の記事を、同じ post_id・URL のまま作り直す。main の記事を読み、その official_url から作り直して、
 *                    既存のファイルを上書きする PR を作る (タイトル・公開日・年は引き継ぎ、updated を書く。Firestore には触れない)。
 *                    URL は指定しない。--dry-run と併用すると PR を作らず、既存の記事との差分を表示する。
 *                    作品の slug が変わったとき、公式サイトを取得できないとき、会場・品目が減ったときは止まる
 *   --allow-shrink   --update で会場・品目が減っても PR を作る
 *
 * 前提条件:
 *   - .env.local に GITHUB_PAT を設定（--dry-run/--local/--upload-images時は不要。--update は --dry-run でも必要 (main の記事を読む)）
 *   - .env.local に AI_PROVIDER に応じたキーを設定 (Claude は ant auth login のプロファイルでキー不要)
 *   - .env.local に R2_* 環境変数を設定（--upload-images時に必要）
 *   - Firebase Admin SDK の認証情報を設定（--dry-run/--local/--upload-images時は不要）
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, relative, resolve } from 'path';
import { mkdir, writeFile, readdir, mkdtemp } from 'fs/promises';
import { existsSync, createWriteStream, type WriteStream } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
// NOTE: override は省略 (= false)。override: true にすると inline env
// (例: `AI_PROVIDER=anthropic pnpm debug:mdx ...`) が .env.local の値で上書きされてしまう。
// もし .env.local の変数が反映されない場合は、shell env に同名の空文字列変数が
// export されていないか確認する必要がある (2026-07-19 検証)。
config({ path: resolve(__dirname, '../.env.local') });

// HTML + タイトル抽出
import { extractArticleData } from '../lib/utils/html-extractor';

// AI ステップの観測ログ
import {
  initAiCallRecorder,
  getAiCallJsonlPath,
} from '../lib/ai/observability/ai-call-recorder';

// MDX生成サービス
import { ArticleGenerationMdxService } from '../lib/services/article-generation-mdx.service';
import type { MdxGenerationRequest, ArticleUpdateTarget } from '../lib/services/article-generation-mdx.service';

// 公開中の記事の更新 (--update)
import { fetchArticleFromMain } from '../lib/github/update-mdx-pr';
import { GitHubAuthError } from '../lib/errors/github';
import { readExistingArticleFields } from '../lib/mdx/article-update';
import { describeShrinkCheck } from '../lib/mdx/article-counts';

// Slack 通知 (SLACK_BOT_TOKEN / SLACK_CHANNEL_ID が無ければ何もしない)
import {
  notifyPipelineResult,
  pipelineNotificationFromResult,
  type PipelineMode,
  type PipelineNotification,
} from '../lib/slack';

/**
 * コマンドライン引数をパース
 */
interface CliArgs {
  url: string;
  dryRun: boolean;
  local: boolean;
  uploadImages: boolean;
  log: boolean;
  /** --update の post_id */
  update?: string;
  allowShrink: boolean;
  /** 引数の組み合わせの誤り */
  argError?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let dryRun = false;
  let local = false;
  let uploadImages = false;
  let log = false;
  let url = '';
  let update: string | undefined;
  let allowShrink = false;
  let argError: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--local') {
      local = true;
    } else if (arg === '--upload-images') {
      uploadImages = true;
    } else if (arg === '--log') {
      log = true;
    } else if (arg === '--update') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        argError = '--update には post_id を指定してください (例: --update 01m4s065g1hchh9d)';
      } else {
        update = value;
        i++;
      }
    } else if (arg === '--allow-shrink') {
      allowShrink = true;
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
  }

  if (update !== undefined) {
    if (url) argError = '--update では URL を指定しません (既存の記事の official_url から作り直します)';
    else if (local || uploadImages) argError = '--update は --local / --upload-images と併用できません';
  } else if (allowShrink && !argError) {
    argError = '--allow-shrink は --update と一緒に使います';
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

  return { url, dryRun, local, uploadImages, log, update, allowShrink, argError };
}

/**
 * 更新前と更新後の記事の差分を表示する (git diff --no-index)。2 つのファイルは一時フォルダに残す
 */
async function printArticleDiff(before: string, after: string, postId: string): Promise<void> {
  const dir = await mkdtemp(resolve(tmpdir(), `ai-writer-update-${postId}-`));
  const beforePath = resolve(dir, 'before.mdx');
  const afterPath = resolve(dir, 'after.mdx');
  await writeFile(beforePath, before, 'utf-8');
  await writeFile(afterPath, after, 'utf-8');

  console.log('\n📑 既存の記事との差分 (main → 作り直した記事):');
  console.log('-'.repeat(60));
  const diff = spawnSync('git', ['diff', '--no-index', '--no-color', beforePath, afterPath], { encoding: 'utf-8' });
  if (diff.error) {
    console.warn(`差分を表示できませんでした (git が見つからない?): ${diff.error.message}`);
  } else {
    console.log(diff.stdout || '(差分なし)');
  }
  console.log('-'.repeat(60));
  console.log(`  更新前: ${beforePath}`);
  console.log(`  更新後: ${afterPath}`);
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

  // 元のconsole.log / console.warn / console.error を保存
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  /**
   * 引数を 1 行の文字列へ整形する。3 つのラッパーで同一処理のため共通化。
   *
   * ★ 従来 log / error で同じコードを 2 回書いており、**warn を足し忘れた**まま
   *   運用されていた (dry-run のログに警告が 1 行も載っていなかった)。
   *   4 つ目のログレベルを足すときに同じ取りこぼしをしないよう切り出す
   *   (claude[bot] 指摘 2026-08-09)。
   */
  const format = (args: unknown[]): string =>
    args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' ');

  /** 元の console メソッドを保ちつつ、ファイルへも書き出すラッパーを作る。 */
  const wrap =
    (original: (...args: unknown[]) => void, prefix = '') =>
    (...args: unknown[]) => {
      logStream.write(prefix + format(args) + '\n');
      original.apply(console, args);
    };

  // console.logをラップ
  console.log = wrap(originalLog);

  // console.warn をラップ
  //
  // ★ 2026-08-09 追加。従来 warn だけ横取りされておらず、**dry-run のログに
  //   一切載っていなかった**。パイプラインの防御層は「throw せず warn する」
  //   規約 (observability) で作られているため、抜けていたのは
  //   「壊れかけていることを知らせる出力」ばかりだった:
  //     - occurrences の連結分割 / 年跨ぎ補正 / 重複除去 / 日付未確定
  //     - 代表会場名の決定でブランド辞書に一致しなかった会場
  //     - 公式ドメインがどのブランドとも一致せず都市名見出しへ切り替えた事実
  //     - event_data が schema 不適合で捨てられた事実
  //   ログを見て「警告ゼロ」と判断すると誤る状態だったため是正する。
  console.warn = wrap(originalWarn, '[WARN] ');

  // console.errorをラップ
  console.error = wrap(originalError, '[ERROR] ');

  // クリーンアップ関数
  const cleanup = () => {
    console.log = originalLog;
    console.warn = originalWarn;
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
  const parsed = parseArgs();
  const { dryRun, local, uploadImages, log, allowShrink } = parsed;

  if (parsed.argError) {
    console.error(`\n❌ エラー: ${parsed.argError}\n`);
    process.exitCode = 1;
    return;
  }

  // --update: main の記事を読み、その official_url から作り直す
  let updateTarget: ArticleUpdateTarget | undefined;
  if (parsed.update) {
    try {
      console.log(`♻️ main の記事を読んでいます: post_id ${parsed.update}`);
      const article = await fetchArticleFromMain(parsed.update);
      const fields = readExistingArticleFields(article.content);
      if (fields.postId !== parsed.update) {
        throw new Error(`${article.path} の post_id が ${fields.postId} です (指定は ${parsed.update})`);
      }
      updateTarget = { article, fields, allowShrink };
      console.log(`✅ ${article.path} (タイトル: ${fields.title})`);
      console.log(`✅ 作り直しに使う公式サイト: ${fields.officialUrl}\n`);
    } catch (error) {
      console.error('\n❌ 更新する記事を読めませんでした:', error instanceof Error ? error.message : error);
      if (error instanceof GitHubAuthError) {
        console.error('  GITHUB_PAT が要ります (--dry-run でも main の記事を読むため)。例: GITHUB_PAT="$(gh auth token)" pnpm debug:mdx --update <post_id> --dry-run');
      }
      process.exitCode = 1;
      return;
    }
  }
  const url = updateTarget ? updateTarget.fields.officialUrl : parsed.url;
  /** 本実行の案内に出すコマンドの引数 */
  const rerunArgs = updateTarget ? `--update ${updateTarget.fields.postId}` : url;

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
    console.log('                   あわせて AI ステップの観測ログを出力:');
    console.log('                     logs/{同じ basename}.jsonl  1 行 = 1 回の AI 呼び出し');
    console.log('                     logs/prompts/*.txt          プロンプト全文の退避先');
    console.log('                   DEBUG_* の設定は不要（既定で全ステップを記録）');
    console.log('  --local          ローカル環境にMDXファイルを保存（--dry-runを自動有効化）');
    console.log('                   保存先: apps/ai-writer/content/{eventType}/{workSlug}/{postId}.mdx');
    console.log('  --upload-images  画像をR2にアップロードしつつローカル保存');
    console.log('                   Firestore登録とGitHub PR作成はスキップ');
    console.log('  --update <post_id>  公開中の記事を同じ post_id・URL のまま作り直し、上書きする PR を作る (URL は指定しない)');
    console.log('                   --dry-run と併用すると PR を作らず、既存の記事との差分を表示する');
    console.log('  --allow-shrink   --update で会場・品目が減っても PR を作る\n');
    console.log('例:');
    console.log('  pnpm debug:mdx https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --dry-run https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --dry-run --log https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --local https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --upload-images https://animeanime.jp/article/2025/11/24/94010.html');
    console.log('  pnpm debug:mdx --update 01m4s065g1hchh9d --dry-run\n');
    process.exitCode = 1;
    return;
  }

  // ログファイル出力のセットアップ
  let logCleanup: (() => void) | undefined;
  let logFilePath: string | undefined;

  // Slack 通知に載せる実行モード (PR を作るのは 'pr' のときだけ)
  const mode: PipelineMode = uploadImages ? 'upload-images' : local ? 'local' : dryRun ? 'dry-run' : 'pr';

  if (log) {
    logFilePath = await generateLogFilePath(url);
    const logging = setupConsoleLogging(logFilePath);
    logCleanup = logging.cleanup;
    console.log(`📝 ログファイル: ${logFilePath}`);

    // ★ 観測ログ (Phase 3.5 A) を有効化する。
    //
    //   **`DEBUG_*` フラグに依存させない**のが要点。従来は 11 個のフラグが各サービス
    //   に散らばっており、`DEBUG_EXTRACTION_PROMPT` だけが未設定だったために
    //   「最重要ステップである抽出のプロンプトが 1 行も残らない」状態が続いていた。
    //   `--log` を付けた時点で全 AI ステップを記録する形にすれば、設定漏れが
    //   原理的に起きない。
    initAiCallRecorder(logFilePath);
    console.log(`📊 観測ログ (JSONL): ${getAiCallJsonlPath()}`);
  }

  // ⚠️ 重複 PR (DuplicateSlugError) は service が `{ success: false, error }` にまとめて返すため、
  //    CLI では「失敗」として開発系チャンネルに届く (メンションなし)。人が実行結果を見ている
  //    経路なので許容している。cron 経路では 409 として通知対象から外している
  const notifyContext = {
    entrypoint: 'cli' as const,
    sourceUrl: url,
    mode,
    // 読みやすさのため apps/ai-writer からの相対パスにする
    logPath: logFilePath ? relative(resolve(__dirname, '..'), logFilePath) : undefined,
  };
  // 通知は 1 実行につき 1 通。finally でまとめて送る
  // (成功の表示中に例外になった場合は catch で失敗に差し替わるので、成功と失敗の 2 通にならない)
  let notification: PipelineNotification | undefined;

  console.log('🔍 URLからMDX記事生成デバッグ開始\n');
  console.log('='.repeat(80));
  if (uploadImages) {
    console.log('🖼️  画像アップロードモード（Firestore/GitHub スキップ + R2アップロード + ファイル保存）');
  } else if (local) {
    console.log('💾 ローカル保存モード（Firestore/GitHub/R2 すべてスキップ + ファイル保存）');
  } else if (dryRun) {
    console.log('🧪 ドライランモード（Firestore/GitHub/R2 すべてスキップ）');
  } else if (updateTarget) {
    console.log('♻️ 記事の更新モード（既存のファイルを上書きする PR を作成）');
  } else {
    console.log('URL指定デバッグモード');
  }
  console.log('='.repeat(80));
  console.log(`URL: ${url}`);
  if (updateTarget) {
    console.log(`更新する記事: ${updateTarget.article.path}${dryRun ? ' (--dry-run のため PR は作らない)' : ''}`);
  }
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
      update: updateTarget,
    };

    const result = await service.generateMdxFromRSS(request);
    notification = pipelineNotificationFromResult(result, notifyContext);

    // ========================================
    // STEP 3: 結果表示
    // ========================================
    console.log();
    console.log('='.repeat(80));
    console.log('📊 生成結果');
    console.log('='.repeat(80));

    // 記事の更新: 会場・品目の数の比較と、既存の記事との差分 (dry-run と、減って止まったとき)
    if (result.update && result.mdxArticle) {
      console.log('\n🔢 会場・品目の数 (更新前 → 更新後):');
      for (const line of describeShrinkCheck(result.update.shrinkCheck)) console.log(`  ${line}`);
      if (dryRun) {
        await printArticleDiff(result.update.before, result.mdxArticle.content, updateTarget!.fields.postId);
        if (result.update.shrinkCheck.shrunk && !allowShrink) {
          console.log('\n⚠️  減った項目があります。本実行では PR を作らずに止まります (続けるには --allow-shrink)');
        }
      }
    }

    if (result.skipped) {
      console.log('\n⚠️  記事生成をスキップしました');
      console.log(`理由: ${result.skipReason}`);
      // 記事の更新では、スキップ = 更新できなかった (公式サイトを取得できないなど)
      if (updateTarget) process.exitCode = 1;
      console.log();
      console.log('='.repeat(80));
      console.log('💡 デバッグヒント:');
      console.log('  - 記事内に公式URLが含まれているか確認してください');
      console.log('  - YAML テンプレートの条件を確認してください');
      console.log('  - DEBUG_HTML_EXTRACTION=true で抽出HTMLを確認できます');
      console.log('='.repeat(80));
      return;
    }

    if (!result.success) {
      console.error('\n❌ MDX記事の生成に失敗しました');
      console.error(`エラー: ${result.error}`);
      console.log();
      // process.exit() は使わない。op run 経由では stdout が pipe になり、POSIX では pipe への
      // 書き込みが非同期のため、末尾の出力が捨てられる (https://nodejs.org/api/process.html)
      process.exitCode = 1;
      return;
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
      console.log(`  pnpm debug:mdx ${rerunArgs}`);
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
      console.log(`📊 観測ログ (JSONL): ${getAiCallJsonlPath()}`);
      // この案内は `scripts/compare-runs.ts` が入る本 PR で足す。
      // 先行 PR (#293) 側に置くと、スクリプトが無い状態で存在しないコマンドを案内する。
      console.log('   → 同一 URL の再実行との比較: pnpm debug:compare <*.jsonl>');
      console.log('='.repeat(80));
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
    console.log('     - AI_PROVIDER に応じたキー (GEMINI_API_KEY / OPENAI_API_KEY。Claude は ant auth login のプロファイル)');
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

    notification = {
      ...notifyContext,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    };
    process.exitCode = 1;
  } finally {
    if (notification) await notifyPipelineResult(notification);
    // ログのクリーンアップ
    logCleanup?.();
  }
}

main();
