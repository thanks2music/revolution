/**
 * Vision API デバッグスクリプト
 *
 * @description
 * 画像URLから直接 Vision API を呼び出し、抽出結果をデバッグするスクリプト。
 * API Route 経由ではなく、直接サービスクラスを呼び出し。
 *
 * 使用方法:
 *   pnpm debug:vision <IMAGE_URL>
 *   pnpm debug:vision <IMAGE_URL1> <IMAGE_URL2>
 *   VISION_API_PROVIDER=openai pnpm debug:vision <IMAGE_URL>
 *
 * 前提条件:
 *   - .env.local に ANTHROPIC_API_KEY を設定（デフォルト、推奨）
 *   - または OPENAI_API_KEY を設定（非推奨: 日本語精度低）
 *   - Next.js 起動不要
 *
 * Phase 1 MVP:
 *   - menu カテゴリのみ対応
 *   - 環境変数でプロバイダー選択（デフォルト: claude）
 *   - Vision API サービスが自動的にログ生成
 *
 * @package revolution
 * @module scripts/debug-vision-api
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env.local を読み込む
config({ path: resolve(__dirname, '../.env.local') });

// Vision API サービス
import { VisionApiServiceFactory } from '../lib/services/vision-api/vision-api-service.factory';
import { buildInterimVisionPrompt } from '../lib/services/vision-api/prompts';
import type { VisionProvider, VisionExtractionResult } from '../lib/types/vision-api';

/**
 * コマンドライン引数
 */
interface DebugVisionArgs {
  imageUrls: string[];
}

/**
 * コマンドライン引数をパース
 */
function parseArgs(): DebugVisionArgs {
  const args = process.argv.slice(2);

  // フラグを除外してURLのみ抽出
  const imageUrls = args.filter(arg => !arg.startsWith('-'));

  return { imageUrls };
}

/**
 * URLからドメイン名を抽出（ログファイル名参照用）
 * 例: https://pripricafe.com/event/... → pripricafe-com
 */
function extractDomainForFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/\./g, '-');
  } catch {
    return 'unknown';
  }
}

/**
 * 入力バリデーション
 */
function validateInputs(args: DebugVisionArgs): void {
  // 画像URLチェック
  if (args.imageUrls.length === 0) {
    throw new Error('画像URLが指定されていません');
  }

  // URLフォーマット + スキームチェック
  for (const url of args.imageUrls) {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      throw new Error(`無効なURL: ${url}`);
    }

    // セキュリティ: http/https のみ許可
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      throw new Error(
        `無効なURLスキーム: ${urlObj.protocol} (http/https のみ許可)\n` +
        `URL: ${url}`
      );
    }
  }

  // API キーチェック
  const provider = (process.env.VISION_API_PROVIDER as VisionProvider) ?? 'claude';
  const apiKeyEnvVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

  if (!process.env[apiKeyEnvVar]) {
    throw new Error(
      `${apiKeyEnvVar} が設定されていません。\n` +
      `💡 .env.local に以下を追加してください:\n` +
      `   ${apiKeyEnvVar}=sk-...`
    );
  }
}

/**
 * ヘルプメッセージ表示
 */
function showHelp(): void {
  console.log(`
Vision API デバッグツール

使用方法:
  pnpm debug:vision <IMAGE_URL>
  pnpm debug:vision <IMAGE_URL1> <IMAGE_URL2> <IMAGE_URL3>
  VISION_API_PROVIDER=openai pnpm debug:vision <IMAGE_URL>

例:
  pnpm debug:vision https://www.pripricafe.com/event/cafe/img/toreve2512_food.webp
  pnpm debug:vision https://example.com/image1.jpg https://example.com/image2.jpg
  VISION_API_PROVIDER=claude pnpm debug:vision https://example.com/image.jpg

環境変数:
  VISION_API_PROVIDER  プロバイダー選択（openai/claude、デフォルト: claude）

前提条件:
  .env.local に以下を設定:
    - ANTHROPIC_API_KEY=sk-ant-... (Claude使用時、デフォルト、推奨)
    - OPENAI_API_KEY=sk-...        (OpenAI使用時、非推奨: 日本語精度低)

注意:
  - OpenAI VisionAPI は日本語の解析精度が低いため、Claude（デフォルト）の使用を推奨
  - Phase 1 は menu カテゴリのみ対応
  - Vision API サービスが自動的にログファイルを生成します
    ログパス: logs/YYYY-MM-DD-VisionAPI-{Provider}-{Domain}-{Sequence}.log
`);
}

/**
 * Format character names array to natural Japanese string
 *
 * @param names - Character names array
 * @returns Formatted string
 *
 * @example
 * - ["武道"] → "武道"
 * - ["武道", "マイキー"] → "武道とマイキー"
 * - ["武道", "マイキー", "場地"] → "武道、マイキーと場地"
 */
function formatCharacterNames(names: string[]): string {
  if (!names || names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}と${names[1]}`;
  return `${names.slice(0, -1).join('、')}と${names[names.length - 1]}`;
}

/**
 * 抽出結果を表示（全カテゴリ: menu / goods / novelty）
 */
function displayResults(
  result: VisionExtractionResult,
  provider: VisionProvider,
  imageUrls: string[]
): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 Vision API 抽出結果');
  console.log('='.repeat(80) + '\n');

  console.log(`🤖 プロバイダー: ${provider.toUpperCase()}`);
  console.log(`🖼️  画像数: ${imageUrls.length}枚`);
  console.log(`✨ 信頼度: ${(result.visionExtraction.confidence * 100).toFixed(1)}%\n`);

  // Phase 0 制限の注意（暫定プロンプトは menu のみ抽出する設計）
  console.log('⚠️  Phase 0 暫定プロンプトは menu カテゴリのみ抽出します');
  console.log('    goods / novelty 画像を渡しても 0 件になる可能性があります');
  console.log('    Templates v3 の YAML 統合後にカテゴリ別抽出に移行予定\n');

  const { menuItems, goodsItems, noveltyItems, metadata } = result.visionExtraction;

  // Coming Soon チェック（全カテゴリで共通）
  if (metadata?.hasComingSoonNotice) {
    console.log('💡 画像に「Coming Soon」の表示が含まれています\n');
  }

  // メニュー
  console.log(`📋 メニューアイテム (${menuItems.length}件):`);
  if (menuItems.length === 0) {
    console.log('  （抽出なし）\n');
  } else {
    console.log('');
    menuItems.forEach((item, index) => {
      const price = item.price != null ? ` / ¥${item.price.toLocaleString()}` : '';
      const char = item.characterName.length > 0
        ? ` (${formatCharacterNames(item.characterName)})`
        : '';
      const conf = item.confidence ? `${(item.confidence * 100).toFixed(1)}%` : 'N/A';

      console.log(`  ${index + 1}. ${item.name}${char}${price} [確信度: ${conf}]`);
    });
    console.log('');
  }

  // グッズ
  console.log(`🛍️  グッズアイテム (${goodsItems.length}件):`);
  if (goodsItems.length === 0) {
    console.log('  （抽出なし）\n');
  } else {
    console.log('');
    goodsItems.forEach((item, index) => {
      const price = item.price != null ? ` / ¥${item.price.toLocaleString()}` : '';
      const variants = item.variantCount != null ? ` / 全${item.variantCount}種` : '';
      const char = item.characterName.length > 0
        ? ` (${formatCharacterNames(item.characterName)})`
        : '';

      console.log(`  ${index + 1}. ${item.name}${char}${price}${variants}`);
    });
    console.log('');
  }

  // ノベルティ
  console.log(`🎁 ノベルティアイテム (${noveltyItems.length}件):`);
  if (noveltyItems.length === 0) {
    console.log('  （抽出なし）\n');
  } else {
    console.log('');
    noveltyItems.forEach((item, index) => {
      const variants = item.variantCount != null ? ` / 全${item.variantCount}種` : '';
      const char = item.characterName.length > 0
        ? ` (${formatCharacterNames(item.characterName)})`
        : '';
      const cond = item.condition ? ` 条件: ${item.condition}` : '';

      console.log(`  ${index + 1}. ${item.name}${char}${variants}${cond}`);
    });
    console.log('');
  }

  console.log('='.repeat(80) + '\n');
}

/**
 * メインデバッグフロー
 */
async function main() {
  try {
    // 1. 引数パース
    const args = parseArgs();

    // ヘルプ表示
    if (args.imageUrls.length === 0) {
      showHelp();
      process.exit(0);
    }

    // 2. バリデーション
    validateInputs(args);

    // 3. プロバイダー決定
    const provider = (process.env.VISION_API_PROVIDER as VisionProvider) ?? 'claude';

    console.log('🔍 Vision API デバッグ開始\n');
    console.log('='.repeat(80));
    console.log(`プロバイダー: ${provider.toUpperCase()}`);
    console.log(`画像URL (${args.imageUrls.length}件):`);
    args.imageUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    console.log('='.repeat(80) + '\n');

    // 4. Vision API サービス生成
    const visionService = VisionApiServiceFactory.create(provider);

    // 5. プロンプト生成（Phase 1: menu カテゴリ固定）
    const prompt = buildInterimVisionPrompt('menu');

    // 6. Vision API 呼び出し
    console.log('🤖 Vision API 呼び出し中...\n');

    const result = await visionService.extractFromImages({
      imageUrls: args.imageUrls,
      prompt,
      category: 'menu',
      maxRetries: 3,
      timeout: 60000,
    });

    // 7. 結果表示
    displayResults(result, provider, args.imageUrls);

    // 8. ログファイルパス表示（Vision API サービスが自動生成）
    const today = new Date().toISOString().split('T')[0];
    const domain = extractDomainForFilename(args.imageUrls[0]);
    const providerCapitalized = provider.charAt(0).toUpperCase() + provider.slice(1);

    console.log(`📝 Vision API ログ: logs/${today}-VisionAPI-${providerCapitalized}-${domain}-01.log`);
    console.log('   （実際の連番はログディレクトリで確認してください）\n');

  } catch (error) {
    console.error('\n❌ エラー発生:', error instanceof Error ? error.message : error);
    console.log();
    process.exit(1);
  }
}

main();
