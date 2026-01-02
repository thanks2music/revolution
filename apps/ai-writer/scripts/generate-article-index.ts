/**
 * article-index.json 生成スクリプト
 *
 * MDXファイルのfrontmatterを解析し、article-index.jsonを自動生成します。
 *
 * 使用方法:
 *   pnpm generate:article-index
 *   pnpm generate:article-index --dry-run
 *   pnpm generate:article-index --verbose
 *
 * オプション:
 *   --dry-run    ファイル出力をスキップ（プレビューのみ）
 *   --verbose    詳細ログを出力
 *
 * 出力先:
 *   apps/frontend/lib/mdx/article-index.json
 *
 * @module scripts/generate-article-index
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, join, relative } from 'path';
import { readdir, readFile, writeFile, stat } from 'fs/promises';

// ES Module で __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * コマンドライン引数
 */
interface CliArgs {
  dryRun: boolean;
  verbose: boolean;
}

/**
 * ArticleIndexItem - 記事インデックスの項目
 * apps/frontend/lib/mdx/articles.ts の型定義と一致させる
 *
 * 全17フィールド（MDX Frontmatter の全項目を保存）
 */
interface ArticleIndexItem {
  // 必須フィールド（基本情報）
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  author: string;
  filePath: string;

  // 必須フィールド（MDX パイプライン固有）
  post_id: string;           // ULID（10文字）
  year: number;              // 年度フィルタリング用
  event_type: string;        // イベントタイプ（例: collabo-cafe）
  event_title: string;       // イベント日本語名（例: コラボカフェ）
  work_title: string;        // 作品公式名（例: らんま1/2）
  work_titles: string[];     // 作品名リスト（複数作品コラボ対応）
  work_slug: string;         // 作品スラッグ
  prefectures: string[];     // 開催都道府県リスト
  prefecture_slugs: string[]; // 都道府県スラッグリスト

  // オプショナルフィールド
  ogImage: string | null;    // OG画像URL（.mjs から追加）
}

/**
 * ArticleIndex - 記事インデックス全体
 */
interface ArticleIndex {
  generatedAt: string;
  totalArticles: number;
  articles: ArticleIndexItem[];
}

/**
 * MDX Frontmatter
 */
interface MdxFrontmatter {
  post_id: string;
  year: number;
  event_type: string;
  event_title: string;
  work_title: string;
  work_titles?: string[];
  work_slug: string;
  prefectures?: string[];
  prefecture_slugs?: string[];
  slug: string;
  title: string;
  date: string;
  categories: string[];
  tags?: string[];
  excerpt: string;
  author: string;
  ogImage?: string;
}

/**
 * コマンドライン引数をパース
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  };
}

/**
 * 必須フィールドのバリデーション
 */
function validateFrontmatter(frontmatter: MdxFrontmatter, filePath: string): string[] {
  const requiredFields: (keyof MdxFrontmatter)[] = [
    'post_id',
    'year',
    'event_type',
    'event_title',
    'work_title',
    'work_slug',
    'slug',
    'title',
    'date',
  ];

  const missingFields = requiredFields.filter(
    (field) => frontmatter[field] === undefined || frontmatter[field] === null
  );

  if (missingFields.length > 0) {
    console.error(`❌ Missing required fields in ${filePath}:`);
    console.error(`   ${missingFields.join(', ')}`);
  }

  return missingFields;
}

/**
 * 簡易YAMLパーサー
 * frontmatterから必要なフィールドを抽出
 */
function parseFrontmatter(content: string): MdxFrontmatter | null {
  // frontmatter部分を抽出
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const result: Record<string, unknown> = {};

  // 行ごとに解析
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    // key: value 形式を解析
    const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!keyValueMatch) continue;

    const [, key, rawValue] = keyValueMatch;
    let value: unknown = rawValue;

    // 配列形式 ["a", "b"] を解析
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      try {
        value = JSON.parse(rawValue.replace(/'/g, '"'));
      } catch {
        // JSON解析失敗時は文字列として保持
        value = rawValue;
      }
    }
    // 数値を解析
    else if (/^\d+$/.test(rawValue)) {
      value = parseInt(rawValue, 10);
    }
    // クォート付き文字列を解析
    else if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      value = rawValue.slice(1, -1);
    }

    result[key] = value;
  }

  return result as unknown as MdxFrontmatter;
}

/**
 * ディレクトリを再帰的に走査してMDXファイルを取得
 */
async function findMdxFiles(dir: string): Promise<string[]> {
  const mdxFiles: string[] = [];

  async function traverse(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        mdxFiles.push(fullPath);
      }
    }
  }

  await traverse(dir);
  return mdxFiles;
}

/**
 * MDXファイルからArticleIndexItemを生成
 */
async function processmdxFile(
  filePath: string,
  contentDir: string,
  verbose: boolean
): Promise<ArticleIndexItem | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      if (verbose) {
        console.log(`  ⚠️  frontmatterなし: ${filePath}`);
      }
      return null;
    }

    // 必須フィールドのバリデーション
    const missingFields = validateFrontmatter(frontmatter, filePath);
    if (missingFields.length > 0) {
      if (verbose) {
        console.log(`  ⚠️  必須フィールド不足（スキップ）: ${filePath}`);
      }
      return null;
    }

    // リポジトリルートからの相対パスを計算
    const repoRoot = resolve(__dirname, '../../..');
    const relativeFilePath = relative(repoRoot, filePath);

    // 全17フィールドを含む ArticleIndexItem を生成
    const item: ArticleIndexItem = {
      // 基本情報
      slug: frontmatter.slug,
      title: frontmatter.title,
      date: frontmatter.date || new Date().toISOString().split('T')[0],
      excerpt: frontmatter.excerpt || '',
      categories: frontmatter.categories || [],
      tags: frontmatter.tags || [],
      author: frontmatter.author || 'thanks2music',
      filePath: relativeFilePath,

      // MDX パイプライン固有フィールド（必須）
      post_id: frontmatter.post_id,
      year: typeof frontmatter.year === 'number' ? frontmatter.year : Number(frontmatter.year),
      event_type: frontmatter.event_type,
      event_title: frontmatter.event_title,
      work_title: frontmatter.work_title,
      work_titles: frontmatter.work_titles || [],
      work_slug: frontmatter.work_slug || '',
      prefectures: frontmatter.prefectures || [],
      prefecture_slugs: frontmatter.prefecture_slugs || [],

      // オプショナルフィールド
      ogImage: frontmatter.ogImage || null,  // .mjs から追加
    };

    return item;
  } catch (error) {
    if (verbose) {
      console.error(`  ❌ エラー: ${filePath}`, error);
    }
    return null;
  }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const { dryRun, verbose } = parseArgs();

  console.log('📚 article-index.json 生成スクリプト\n');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('🧪 ドライランモード（ファイル出力スキップ）');
  }
  if (verbose) {
    console.log('📝 詳細ログモード');
  }
  console.log('='.repeat(60));
  console.log();

  // パス設定
  const contentDir = resolve(__dirname, '../content');
  const outputPath = resolve(__dirname, '../../frontend/lib/mdx/article-index.json');

  console.log(`📁 コンテンツディレクトリ: ${contentDir}`);
  console.log(`📄 出力先: ${outputPath}`);
  console.log();

  // コンテンツディレクトリの存在確認
  try {
    await stat(contentDir);
  } catch {
    console.error(`❌ コンテンツディレクトリが見つかりません: ${contentDir}`);
    process.exit(1);
  }

  // MDXファイルを検索
  console.log('🔍 MDXファイルを検索中...');
  const mdxFiles = await findMdxFiles(contentDir);
  console.log(`   ${mdxFiles.length} 件のMDXファイルを発見\n`);

  if (mdxFiles.length === 0) {
    console.log('⚠️  MDXファイルが見つかりません');
    process.exit(0);
  }

  // 各ファイルを処理
  console.log('📖 frontmatterを解析中...');
  const articles: ArticleIndexItem[] = [];

  for (const filePath of mdxFiles) {
    if (verbose) {
      console.log(`  処理中: ${filePath}`);
    }

    const item = await processmdxFile(filePath, contentDir, verbose);
    if (item) {
      articles.push(item);
    }
  }

  console.log(`   ${articles.length} 件の記事を処理\n`);

  // 日付でソート（新しい順）
  articles.sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  // インデックスを生成
  const index: ArticleIndex = {
    generatedAt: new Date().toISOString(),
    totalArticles: articles.length,
    articles,
  };

  // 結果をプレビュー
  console.log('📊 生成結果プレビュー:');
  console.log('-'.repeat(60));
  console.log(`  生成日時: ${index.generatedAt}`);
  console.log(`  記事数: ${index.totalArticles}`);
  console.log();

  if (verbose || articles.length <= 5) {
    console.log('  記事一覧:');
    for (const article of articles) {
      console.log(`    - [${article.slug}] ${article.title}`);
      console.log(`      ${article.filePath}`);
    }
    console.log();
  } else {
    console.log('  記事一覧（最初の5件）:');
    for (const article of articles.slice(0, 5)) {
      console.log(`    - [${article.slug}] ${article.title}`);
    }
    console.log(`    ... 他 ${articles.length - 5} 件`);
    console.log();
  }

  // ファイル出力
  if (dryRun) {
    console.log('🧪 ドライラン: ファイル出力をスキップしました');
    console.log();
    console.log('📋 出力されるJSON（プレビュー）:');
    console.log('-'.repeat(60));
    console.log(JSON.stringify(index, null, 2));
    console.log('-'.repeat(60));
  } else {
    console.log('💾 ファイルを出力中...');
    await writeFile(outputPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');
    console.log(`✅ 出力完了: ${outputPath}`);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('✅ 処理完了！');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('❌ エラー:', error);
  process.exit(1);
});
