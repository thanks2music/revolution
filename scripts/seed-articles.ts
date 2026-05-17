#!/usr/bin/env tsx
/**
 * seed-articles.ts — Frontend 視覚検証用ダミー記事ジェネレーター (Sprint 5)
 *
 * 目的:
 *   apps/frontend の Sky × Lightning Editorial デザイン (PR #224) で構築された
 *   集合系 UI (ArticleCard / ArticleGrid / RelatedArticles / EventFactCard) を
 *   現実的な記事母集団 (50 件) で視覚検証するためのダミー MDX を生成する。
 *
 * 4 状態カバー (バッジ視覚検証):
 *   - 15 件 = coming-soon (今日 +1〜+30 日に開始 → 黄色「あと N 日」バッジ)
 *   - 15 件 = now         (start ≤ today ≤ end → 緑「開催中」バッジ)
 *   - 15 件 = ended       (end < today → グレー「終了」バッジ)
 *   -  5 件 = unknown     (4 フィールド無 → フォールバック「詳細を確認」バッジ)
 *
 * ⚠️  WARNING:
 *   本記事は frontend デザイン視覚検証専用のダミーデータです。
 *   MVP リリース前に必ず削除してください:
 *     find apps/ai-writer/content/__seed__ -name 'seed-*.mdx' -delete
 *     pnpm --filter @revolution/ai-writer generate:article-index
 *
 * 使用方法:
 *   pnpm seed:articles                           # 50 件本実行
 *   pnpm seed:articles --count=10 --dry-run      # 10 件 DRY-RUN
 *   pnpm seed:articles --verbose                 # 詳細ログ
 *
 * オプション:
 *   --count=N        生成件数 (デフォルト 50)
 *   --output-dir=P   出力先 (デフォルト apps/ai-writer/content/__seed__)
 *   --dry-run        ファイル出力をスキップ
 *   --verbose        詳細ログ出力
 *
 * @module scripts/seed-articles
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// 型定義
// =============================================================================

interface CliArgs {
  count: number;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
}

export interface SeedDistribution {
  comingSoon: number;
  now: number;
  ended: number;
  unknown: number;
}

export type EventState = 'coming-soon' | 'now' | 'ended' | 'unknown';

export interface SeedArticle {
  post_id: string;
  state: EventState;
  workSlug: string;
  workTitle: string;
  /** YYYY-MM-DD (event_start_date 用)、unknown の場合は undefined */
  eventStartDate?: string;
  /** YYYY-MM-DD (event_end_date 用)、unknown の場合は undefined */
  eventEndDate?: string;
  /** ISO 8601 ms (記事公開日、frontmatter `date` 用) */
  publishDate: string;
}

// =============================================================================
// Pure functions (Layer 1)
// =============================================================================

/**
 * RelatedArticles の `matchesWork` 経路を踏める母集団にするため、複数記事が同一
 * work_slug を共有するよう WORK_FIXTURES を循環使用する。`seed-` prefix で
 * 本番作品 slug との衝突を防ぐ。
 */
const WORK_FIXTURES = [
  { slug: 'seed-spy-family', title: 'SPY×FAMILY' },
  { slug: 'seed-tougenanki', title: '桃源暗鬼' },
  { slug: 'seed-frieren', title: '葬送のフリーレン' },
  { slug: 'seed-jujutsu-kaisen', title: '呪術廻戦' },
  { slug: 'seed-chainsaw-man', title: 'チェンソーマン' },
] as const;

/**
 * 件数から 4 状態の分布を計算する。3:3:3:1 比例配分 (`Math.floor` ベース) で、
 * 余り (count - 3*triState) を unknown に積むことで合計を厳密に count と一致させる。
 *
 * count=50 (Plan 確定値) の場合: `floor(150/10)=15` で `15/15/15/5` が自然に得られる。
 * Math.round 採用時に発生していた「small count で合計が count を超える」バグ
 * (例: 旧実装 count=2 → 1/1/1/0=3、現実装 count=2 → 0/0/0/2=2) を回避する。
 */
export function calculateDistribution(count: number): SeedDistribution {
  if (!Number.isInteger(count) || count <= 0) {
    return { comingSoon: 0, now: 0, ended: 0, unknown: 0 };
  }
  const triState = Math.floor((count * 3) / 10);
  const comingSoon = triState;
  const now = triState;
  const ended = triState;
  const unknown = count - comingSoon - now - ended;
  return { comingSoon, now, ended, unknown };
}

/**
 * Today から daysOffset 日後の YYYY-MM-DD 文字列を返す (実行環境のローカル基準)。
 * EventFactCard 側は `parseLocalDate(YYYY-MM-DD)` でローカル日付として解釈するため、
 * ここも **ローカル基準** で算出しないと JST など UTC+ 環境で深夜帯に「今日/昨日」が
 * 1 日ずれ、coming-soon / now / ended の seed 分布が崩れて視覚検証が不安定になる。
 */
function dateOffsetYMD(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today から daysOffset 日後の ISO 8601 ms を返す (記事公開日 publishDate 用)。
 */
function dateOffsetISO(daysOffset: number, hourOffset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  d.setUTCHours(d.getUTCHours() + hourOffset);
  return d.toISOString();
}

/**
 * 分布から SeedArticle スペック配列を生成する (純粋関数)。
 * post_id / filename には常に `seed-{state}-{NNN}` の prefix を強制し、
 * grep / find で全件即特定可能にする (削除フロー必須)。
 */
export function generateSeedSpecs(distribution: SeedDistribution): SeedArticle[] {
  const specs: SeedArticle[] = [];
  let serial = 0;

  // coming-soon: 今日 +1 〜 +30 日に開始、+15 〜 +44 日に終了
  for (let i = 0; i < distribution.comingSoon; i++) {
    serial++;
    const startOffset = (i % 30) + 1;
    const endOffset = startOffset + 14;
    const work = WORK_FIXTURES[serial % WORK_FIXTURES.length];
    specs.push({
      post_id: `seed-coming-${String(serial).padStart(3, '0')}`,
      state: 'coming-soon',
      workSlug: work.slug,
      workTitle: work.title,
      eventStartDate: dateOffsetYMD(startOffset),
      eventEndDate: dateOffsetYMD(endOffset),
      publishDate: dateOffsetISO(-i, -i),
    });
  }

  // now: 過去 1 〜 14 日に開始 → +1 〜 +14 日に終了 (today を含む期間)
  for (let i = 0; i < distribution.now; i++) {
    serial++;
    const startOffset = -((i % 14) + 1);
    const endOffset = (i % 14) + 1;
    const work = WORK_FIXTURES[serial % WORK_FIXTURES.length];
    specs.push({
      post_id: `seed-now-${String(serial).padStart(3, '0')}`,
      state: 'now',
      workSlug: work.slug,
      workTitle: work.title,
      eventStartDate: dateOffsetYMD(startOffset),
      eventEndDate: dateOffsetYMD(endOffset),
      publishDate: dateOffsetISO(startOffset - 7, -i),
    });
  }

  // ended: 過去に終了 (-1 〜 -90 日)
  for (let i = 0; i < distribution.ended; i++) {
    serial++;
    const endOffset = -((i % 90) + 1);
    const startOffset = endOffset - 14;
    const work = WORK_FIXTURES[serial % WORK_FIXTURES.length];
    specs.push({
      post_id: `seed-ended-${String(serial).padStart(3, '0')}`,
      state: 'ended',
      workSlug: work.slug,
      workTitle: work.title,
      eventStartDate: dateOffsetYMD(startOffset),
      eventEndDate: dateOffsetYMD(endOffset),
      publishDate: dateOffsetISO(startOffset - 7, -i),
    });
  }

  // unknown: 4 フィールド無 (event_start_date / event_end_date / venue / official_url 全て省略)
  for (let i = 0; i < distribution.unknown; i++) {
    serial++;
    const work = WORK_FIXTURES[serial % WORK_FIXTURES.length];
    specs.push({
      post_id: `seed-unknown-${String(serial).padStart(3, '0')}`,
      state: 'unknown',
      workSlug: work.slug,
      workTitle: work.title,
      publishDate: dateOffsetISO(-30 - i, -i),
    });
  }

  return specs;
}

const STATE_LABELS: Record<EventState, string> = {
  'coming-soon': '開催決定',
  now: '開催中',
  ended: '開催終了',
  unknown: '日程未定',
};

/**
 * SeedArticle スペックから MDX 文字列を生成する (純粋関数、副作用なし)。
 * frontmatter は MdxFrontmatterSchema に適合するよう構造を厳密に揃える:
 *   - title は 40 char 以内 (既存 generate-article-index.test.ts の制約)
 *   - date は ISO 8601 ms with offset
 *   - event_start_date / event_end_date は YYYY-MM-DD (state==='unknown' の場合は省略)
 */
export function renderMdx(spec: SeedArticle): string {
  const stateLabel = STATE_LABELS[spec.state];
  const year = new Date(spec.publishDate).getUTCFullYear();
  // タイトル 40 char 制約 (generate-article-index.test.ts の Title Validation)
  const baseTitle = `${spec.workTitle} カフェ ${stateLabel}`;
  const title = baseTitle.length > 40 ? baseTitle.slice(0, 40) : baseTitle;

  const lines: string[] = [
    '---',
    `post_id: "${spec.post_id}"`,
    `year: ${year}`,
    `event_type: "collabo-cafe"`,
    `event_title: "コラボカフェ"`,
    `work_title: "${spec.workTitle}"`,
    `work_titles: ["${spec.workTitle}"]`,
    `work_slug: "${spec.workSlug}"`,
    `slug: "${spec.post_id}"`,
    `title: "${title}"`,
    `date: "${spec.publishDate}"`,
    `categories: ["${spec.workTitle}", "コラボカフェ"]`,
    `excerpt: "${spec.workTitle}のコラボカフェ ${stateLabel}。frontend デザイン視覚検証用ダミー記事。"`,
    `author: "thanks2music"`,
    `ogImage: "https://example.com/seed/${spec.post_id}.png"`,
    `prefectures: ["東京都"]`,
    `prefecture_slugs: ["tokyo"]`,
  ];

  if (spec.eventStartDate && spec.eventEndDate) {
    lines.push(`event_start_date: "${spec.eventStartDate}"`);
    lines.push(`event_end_date: "${spec.eventEndDate}"`);
    lines.push(`venue: "BOX cafe&space 東京池袋店 (seed)"`);
    lines.push(`official_url: "https://example.com/seed/${spec.post_id}"`);
  }

  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Seed article (state=${spec.state}) — frontend 視覚検証用ダミーデータ。`);
  lines.push(`> MVP リリース前に \`pnpm seed:clean\` で削除すること。`);
  lines.push('');
  lines.push(`本記事は ${spec.workTitle} のコラボカフェ ${stateLabel} を題材にしたダミーです。`);
  lines.push(`Sky × Lightning Editorial デザインの集合系 UI 視覚検証のために自動生成されました。`);
  lines.push('');

  return lines.join('\n');
}

// =============================================================================
// CLI (Layer 2: file I/O 境界)
// =============================================================================

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const getArg = (name: string, defaultValue: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.slice(`--${name}=`.length) : defaultValue;
  };

  // --count は 1 以上の整数のみ受け付ける。NaN や 0 / 負数で先に進むと
  // calculateDistribution が {0,0,0,0} を返し、DRY-RUN の renderMdx(specs[0]) で
  // undefined 参照クラッシュとなるため、ここで早期 reject する。
  const rawCount = getArg('count', '50');
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count <= 0) {
    console.error(
      `❌ --count は 1 以上の整数を指定してください (受け取った値: "${rawCount}")`,
    );
    process.exit(1);
  }

  // scripts/ から見て repo root は親ディレクトリ
  const repoRoot = resolve(__dirname, '..');
  return {
    count,
    outputDir: getArg('output-dir', join(repoRoot, 'apps/ai-writer/content/__seed__')),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const distribution = calculateDistribution(args.count);
  const total = distribution.comingSoon + distribution.now + distribution.ended + distribution.unknown;

  console.log('🌱 Seed Articles 生成スクリプト\n');
  console.log('='.repeat(60));
  console.log(
    `📊 分布: coming-soon=${distribution.comingSoon} / now=${distribution.now} / ended=${distribution.ended} / unknown=${distribution.unknown} (total=${total})`
  );
  console.log(`📁 出力先: ${args.outputDir}`);
  if (args.dryRun) console.log('🧪 DRY-RUN モード (ファイル出力スキップ)');
  console.log('='.repeat(60));
  console.log();

  const specs = generateSeedSpecs(distribution);
  console.log(`📝 ${specs.length} 件の MDX を準備中...`);

  if (!args.dryRun) {
    await mkdir(args.outputDir, { recursive: true });
  }

  let written = 0;
  for (const spec of specs) {
    const mdx = renderMdx(spec);
    const filePath = join(args.outputDir, `${spec.post_id}.mdx`);

    if (args.verbose) {
      const dates =
        spec.eventStartDate && spec.eventEndDate
          ? `[${spec.eventStartDate} → ${spec.eventEndDate}]`
          : '[no event dates]';
      console.log(`  - [${spec.state}] ${spec.post_id} (work=${spec.workSlug}) ${dates}`);
    }

    if (!args.dryRun) {
      await writeFile(filePath, mdx, 'utf-8');
      written++;
    }
  }

  console.log();
  if (args.dryRun) {
    console.log('🧪 DRY-RUN 完了 (ファイル出力スキップ)');
    console.log();
    // parseArgs で count>=1 を validate しているため通常到達しないが、
    // calculateDistribution が将来 0 件を返す経路を増やしても落ちないよう defensive にガード。
    if (specs.length > 0) {
      console.log('📋 サンプル MDX (1 件目):');
      console.log('-'.repeat(60));
      console.log(renderMdx(specs[0]));
      console.log('-'.repeat(60));
    } else {
      console.log('📋 (specs が空のためサンプル MDX 表示をスキップ)');
    }
  } else {
    console.log(`✅ ${written} 件の MDX を生成しました: ${args.outputDir}`);
    console.log();
    console.log('次に実行:');
    console.log('  pnpm --filter @revolution/ai-writer generate:article-index');
  }

  console.log();
  console.log('⚠️  WARNING: 本記事は frontend 視覚検証用ダミーデータです。');
  console.log('   MVP リリース前に必ず削除してください:');
  console.log(`     find ${args.outputDir} -name 'seed-*.mdx' -delete`);
  console.log('     pnpm --filter @revolution/ai-writer generate:article-index');
}

// CLI として直接起動された場合のみ main() を呼ぶ。テストからは pure 関数のみ import 可能。
// `.ts` の endsWith 比較は tsx 経由でしか動かず、`.js` 変換後や bundle 後にすり抜ける。
// Node.js ESM 標準 idiom である `import.meta.url === pathToFileURL(argv[1]).href` 比較で
// 拡張子非依存に判定する (Node 22 互換、Node 24+ の `import.meta.main` の代替)。
const invokedDirectly =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('❌ エラー:', err);
    process.exit(1);
  });
}
