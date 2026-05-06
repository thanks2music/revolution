/**
 * Vision API デバッグスクリプト
 *
 * @description
 * 画像URLから直接 Vision API を呼び出し、抽出結果をデバッグするスクリプト。
 * API Route 経由ではなく、直接サービスクラスを呼び出し。
 *
 * 使用方法:
 *   pnpm debug:vision <IMAGE_URL>...
 *   pnpm debug:vision --category=menu <IMAGE_URL>
 *   pnpm debug:vision --category=all <IMAGE_URL1> <IMAGE_URL2>
 *   VISION_API_PROVIDER=openai pnpm debug:vision <IMAGE_URL>
 *
 * 前提条件:
 *   - .env.local に ANTHROPIC_API_KEY を設定（デフォルト、推奨）
 *   - または OPENAI_API_KEY を設定（非推奨: 日本語精度低）
 *   - Next.js 起動不要
 *
 * Templates v1.2 統合後:
 *   - --category で menu/goods/novelty/all を切替可能（デフォルト all）
 *   - all は 3 カテゴリ並列呼び出し (Promise.allSettled) で orchestrator 経由
 *   - menu/goods/novelty は当該カテゴリのみ extractFromImages 直接呼び出し
 *   - プロンプトは Templates v1.2 YAML から読み込み (loadVisionApiTemplate 経由)
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
import { callVisionApiForAllCategories } from '../lib/services/vision-api/multi-category-vision.service';
import { YamlTemplateLoaderService } from '../lib/services/yaml-template-loader.service';
import type {
  VisionProvider,
  VisionExtractionResult,
} from '../lib/types/vision-api';

type CategoryFlag = 'menu' | 'goods' | 'novelty' | 'all';

/**
 * コマンドライン引数
 */
interface DebugVisionArgs {
  imageUrls: string[];
  category: CategoryFlag;
}

/**
 * コマンドライン引数をパース
 *
 * Supports:
 *   --category=menu / --category menu (long-form value or space-separated)
 *   non-flag positional args are treated as image URLs.
 */
function parseArgs(): DebugVisionArgs {
  const args = process.argv.slice(2);
  const imageUrls: string[] = [];
  let category: CategoryFlag = 'all';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--category' && i + 1 < args.length) {
      const value = args[i + 1];
      category = parseCategoryValue(value);
      i++; // consume next token
    } else if (arg.startsWith('--category=')) {
      const value = arg.slice('--category='.length);
      category = parseCategoryValue(value);
    } else if (!arg.startsWith('-')) {
      imageUrls.push(arg);
    }
    // Other --flag tokens are ignored (forward-compat for future flags).
  }

  return { imageUrls, category };
}

function parseCategoryValue(value: string): CategoryFlag {
  if (value === 'menu' || value === 'goods' || value === 'novelty' || value === 'all') {
    return value;
  }
  throw new Error(
    `Invalid --category value: "${value}" (must be one of: menu, goods, novelty, all)`,
  );
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
  pnpm debug:vision <IMAGE_URL>...
  pnpm debug:vision --category=menu <IMAGE_URL>
  pnpm debug:vision --category=all <IMAGE_URL1> <IMAGE_URL2>
  VISION_API_PROVIDER=openai pnpm debug:vision <IMAGE_URL>

例:
  # デフォルト (--category=all): 3 カテゴリ並列呼び出し
  pnpm debug:vision \\
    https://www.pripricafe.com/event/cafe/img/tr2604_sb_food.webp \\
    https://www.pripricafe.com/event/cafe/img/tr2604_sb_goods.webp \\
    https://www.pripricafe.com/event/cafe/img/tr2604_sb_camp.webp

  # 単一カテゴリのみ呼び出し
  pnpm debug:vision --category=goods \\
    https://www.pripricafe.com/event/cafe/img/tr2604_sb_goods.webp

  # OpenAI で実行
  VISION_API_PROVIDER=openai pnpm debug:vision --category=menu <IMAGE_URL>

オプション:
  --category=<value>  抽出カテゴリ (menu / goods / novelty / all、デフォルト: all)
                      all = 3 カテゴリ並列呼び出し (orchestrator 経由)
                      menu/goods/novelty = 単一カテゴリ呼び出し (extractFromImages 直接)

環境変数:
  VISION_API_PROVIDER  プロバイダー選択 (openai / claude、デフォルト: claude)

前提条件:
  .env.local に以下を設定:
    - ANTHROPIC_API_KEY=sk-ant-... (Claude使用時、デフォルト、推奨)
    - OPENAI_API_KEY=sk-...        (OpenAI使用時、非推奨: 日本語精度低)

注意:
  - OpenAI VisionAPI は日本語の解析精度が低いため、Claude（デフォルト）の使用を推奨
  - --category=all では入力画像をすべて 3 カテゴリ全てに渡します
    (本番の Step 1.8 では category-image-extractor がカテゴリ別に振り分けて渡します)
  - Vision API サービスが自動的にログファイルを生成します（NODE_ENV != production 時のみ）
    OpenAI: logs/YYYY-MM-DD-VisionAPI-OpenAI-{domain}-{category}-{ms}.log
    Claude: logs/YYYY-MM-DD-VisionAPI-Claude-{domain}-{ms}.log
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
  imageUrls: string[],
  category: CategoryFlag,
): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 Vision API 抽出結果');
  console.log('='.repeat(80) + '\n');

  console.log(`🤖 プロバイダー: ${provider.toUpperCase()}`);
  console.log(`📂 カテゴリ: ${category}`);
  console.log(`🖼️  画像数: ${imageUrls.length}枚`);
  console.log(`✨ 信頼度: ${(result.visionExtraction.confidence * 100).toFixed(1)}%\n`);

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
      const novelty = item.hasNovelty
        ? ` 🎁${item.noveltyCondition ?? 'ノベルティあり'}`
        : '';

      console.log(`  ${index + 1}. ${item.name}${char}${price}${novelty} [確信度: ${conf}]`);
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
      const random = item.isRandomSale ? ' 🎲ランダム販売' : '';
      const char = item.characterName.length > 0
        ? ` (${formatCharacterNames(item.characterName)})`
        : '';

      console.log(`  ${index + 1}. ${item.name}${char}${price}${variants}${random}`);
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
      const random = item.isRandom ? ' 🎲ランダム配布' : '';
      const char = item.characterName.length > 0
        ? ` (${formatCharacterNames(item.characterName)})`
        : '';
      const cond = item.condition ? ` 条件: ${item.condition}` : '';

      console.log(`  ${index + 1}. ${item.name}${char}${variants}${random}${cond}`);
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
    console.log(`カテゴリ: ${args.category}`);
    console.log(`画像URL (${args.imageUrls.length}件):`);
    args.imageUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    console.log('='.repeat(80) + '\n');

    // 4. Vision API サービス + Templates v1.2 YAML loader を初期化
    const visionService = VisionApiServiceFactory.create(provider);
    const yamlLoader = new YamlTemplateLoaderService();
    const visionTemplate = await yamlLoader.loadVisionApiTemplate('collabo-cafe');

    // 5. 抽出実行 (--category=all は orchestrator 経由、単一カテゴリは直接呼出)
    let result: VisionExtractionResult;
    let perCategory:
      | Record<'menu' | 'goods' | 'novelty', { ok: boolean; error?: string; skipped?: string }>
      | undefined;

    if (args.category === 'all') {
      console.log('🤖 Vision API 並列呼び出し中 (menu/goods/novelty)...\n');

      // CLI では画像をカテゴリ別に分類していないため、すべての画像を 3 カテゴリ全てに渡す。
      // 本番の Step 1.8 では category-image-extractor.service.ts がカテゴリ別に振り分け済の
      // categoryImages を渡すため、本 CLI とは画像の振り分け方が異なる点に注意。
      const orchestrated = await callVisionApiForAllCategories(
        visionService,
        visionTemplate,
        {
          menu: args.imageUrls,
          goods: args.imageUrls,
          novelty: args.imageUrls,
        },
        { maxRetries: 3, timeout: 60000 },
      );
      result = orchestrated.result;
      perCategory = orchestrated.perCategory;
    } else {
      console.log(`🤖 Vision API 単一カテゴリ呼び出し中 (${args.category})...\n`);

      const promptKey = `${args.category}_extraction` as const;
      const prompt = visionTemplate.prompts[promptKey].content;

      result = await visionService.extractFromImages({
        imageUrls: args.imageUrls,
        prompt,
        category: args.category,
        maxRetries: 3,
        timeout: 60000,
      });
    }

    // 6. 結果表示
    displayResults(result, provider, args.imageUrls, args.category);

    // 7. Per-category status (--category=all のみ)
    if (perCategory) {
      console.log('📊 Per-Category Status:');
      console.log(`  menu:    ${JSON.stringify(perCategory.menu)}`);
      console.log(`  goods:   ${JSON.stringify(perCategory.goods)}`);
      console.log(`  novelty: ${JSON.stringify(perCategory.novelty)}`);
      console.log();
    }

    // 8. ログファイルパス表示（Vision API サービスが自動生成）
    // Filename pattern (post commits 300f485 / cd9df62, sequence replaced by ms timestamp):
    //   OpenAI : logs/YYYY-MM-DD-VisionAPI-OpenAI-<domain>-<category>-<ms>.log
    //   Claude : logs/YYYY-MM-DD-VisionAPI-Claude-<domain>-<ms>.log
    const today = new Date().toISOString().split('T')[0];
    const domain = extractDomainForFilename(args.imageUrls[0]);
    const providerCapitalized = provider.charAt(0).toUpperCase() + provider.slice(1);

    console.log(`📝 Vision API ログ: logs/${today}-VisionAPI-${providerCapitalized}-${domain}-*.log`);
    console.log('   （実際のファイル名は ms タイムスタンプ。最新ファイルは "ls -lt logs/" で確認してください）\n');

  } catch (error) {
    console.error('\n❌ エラー発生:', error instanceof Error ? error.message : error);
    console.log();
    process.exit(1);
  }
}

main();
