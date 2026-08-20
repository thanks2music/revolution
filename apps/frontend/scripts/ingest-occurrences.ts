/**
 * occurrence 取り込み CLI (S3 = mvp-definition A-4、staging 限定)
 *
 * article-index.json の `event_data` を staging Supabase へ upsert する。
 * GitHub Actions (`.github/workflows/ingest-occurrences.yml`) から呼ばれるが、
 * ローカルからも同じ形で実行できる。
 *
 * 使い方:
 *   INGEST_DATABASE_URL='postgresql://...pooler...' \
 *   pnpm ingest:occurrences [--dry-run] [--index <path>]
 *
 * - `INGEST_DATABASE_URL` は専用 env (DATABASE_URL へフォールバックしない、
 *   seed-masters.ts の SEED_DATABASE_URL と同じ事故防止)
 * - `--dry-run`: DB からスナップショットを読み、実行計画とキューを表示するだけ
 *   (書き込みなし)
 * - 出力: 実行サマリを stdout へ。`GITHUB_STEP_SUMMARY` があれば Markdown 表を
 *   追記し、人手キューを `ingest-queue.json` (cwd) へ書く (Actions が artifact 化)
 * - exit code: 人手キューのみなら 0 (`::warning::` を出す)。入力の zod 違反や
 *   DB 接続失敗など、取り込み自体が成立しない場合は 1
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { EventDataSchema } from '@revolution/schemas/mdx-frontmatter';

import { executePlan, fetchSnapshot } from '../lib/ingest/execute-ingest';
import { planIngest, type ArticleEventData, type IngestPlan } from '../lib/ingest/plan-ingest';

const DRY_RUN = process.argv.includes('--dry-run');
const indexFlag = process.argv.indexOf('--index');
const INDEX_PATH =
  indexFlag >= 0 && process.argv[indexFlag + 1]
    ? process.argv[indexFlag + 1]
    : resolve(process.cwd(), 'lib/mdx/article-index.json');

function fail(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function loadArticles(): ArticleEventData[] {
  interface RawIndex {
    articles: Array<{ slug: string; event_data?: unknown }>;
  }
  const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as RawIndex;

  const articles: ArticleEventData[] = [];
  const invalid: string[] = [];
  let withoutEventData = 0;

  for (const article of raw.articles) {
    if (article.event_data === undefined) {
      withoutEventData += 1;
      continue;
    }
    const parsed = EventDataSchema.safeParse(article.event_data);
    if (!parsed.success) {
      invalid.push(`${article.slug}: ${parsed.error.issues.map((i) => i.message).join(' / ')}`);
      continue;
    }
    articles.push({ articleSlug: article.slug, eventData: parsed.data });
  }

  if (withoutEventData > 0) {
    console.log(`ℹ️ event_data の無い記事 ${withoutEventData} 件をスキップしました`);
  }
  if (invalid.length > 0) {
    for (const line of invalid) console.error(`  - ${line}`);
    fail(
      `event_data が zod 契約 (EventDataSchema) に違反した記事 ${invalid.length} 件。上流 (AI Writer / index 生成) の不具合なので取り込みを中止します。`,
    );
  }
  return articles;
}

function printPlan(plan: IngestPlan): void {
  console.log('--- 取り込み計画 ---');
  console.log(`記事:            ${plan.stats.articles} 件 (うちスキップ ${plan.stats.articlesSkipped})`);
  console.log(`events:          ${plan.events.length} 件`);
  console.log(`event_titles:    ${plan.eventTitles.length} 件`);
  console.log(`event_categories:${plan.eventCategories.length} 件`);
  console.log(
    `occurrences:     ${plan.stats.occurrencesPlanned} 件 (insert ${plan.occurrences.filter((o) => o.action === 'insert').length} / update ${plan.occurrences.filter((o) => o.action === 'update').length})`,
  );
  console.log(`verified=true:   ${plan.occurrences.filter((o) => o.verified).length} 件`);
  console.log(`人手キュー:      ${plan.queue.length} 件`);
  for (const item of plan.queue) {
    console.log(`  - [${item.reason}] ${item.detail} (記事 ${item.articleSlug})`);
  }
}

function writeGithubSummary(plan: IngestPlan, resultLine: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const lines = [
    '## occurrence 取り込み結果 (staging)',
    '',
    resultLine,
    '',
    `| 項目 | 件数 |`,
    `|---|---|`,
    `| events | ${plan.events.length} |`,
    `| occurrences (計画) | ${plan.stats.occurrencesPlanned} |`,
    `| verified=true | ${plan.occurrences.filter((o) => o.verified).length} |`,
    `| 人手キュー | ${plan.queue.length} |`,
    '',
  ];
  if (plan.queue.length > 0) {
    lines.push('### 人手キュー (承認 → venue-master.yaml / title-romaji-mapping.yaml へ追記 → seed → 再実行)');
    lines.push('', '| reason | 対象 | 記事 | event |', '|---|---|---|---|');
    for (const item of plan.queue) {
      lines.push(`| ${item.reason} | ${item.detail} | ${item.articleSlug} | ${item.eventSlug ?? '—'} |`);
    }
    lines.push('');
  }
  appendFileSync(summaryPath, lines.join('\n'));
}

async function main(): Promise<void> {
  const articles = loadArticles();

  const dbUrl = process.env.INGEST_DATABASE_URL;
  if (!dbUrl) {
    fail(
      'INGEST_DATABASE_URL が未設定です。staging の pooler URL を渡してください (DATABASE_URL へはフォールバックしません)。',
    );
  }
  const client = postgres(dbUrl, { prepare: false });
  const db = drizzle(client);

  try {
    const snapshot = await fetchSnapshot(db);
    const plan = planIngest(articles, snapshot);
    printPlan(plan);

    if (plan.queue.length > 0) {
      writeFileSync('ingest-queue.json', `${JSON.stringify(plan.queue, null, 2)}\n`);
      console.log(`::warning::人手キュー ${plan.queue.length} 件 (ingest-queue.json / Job Summary を確認)`);
    }

    if (DRY_RUN) {
      writeGithubSummary(plan, '**dry-run のため書き込みは行っていません。**');
      console.log('\n(--dry-run のため書き込みは行いません)');
      return;
    }

    const result = await executePlan(db, plan);
    console.log('--- 実行結果 ---');
    console.log(
      `events upsert: ${result.eventsUpserted} / occurrences insert: ${result.occurrencesInserted} / update: ${result.occurrencesUpdated}`,
    );
    console.log(
      `event_titles: ${result.eventTitlesUpserted} / event_categories: ${result.eventCategoriesUpserted}`,
    );

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.error(`  - event "${failure.eventSlug}" の取り込みに失敗: ${failure.message}`);
      }
      writeGithubSummary(
        plan,
        `⚠️ **event 単位の失敗 ${result.failures.length} 件** (他 event は取り込み済み)。ログを確認してください。`,
      );
      fail(`event 単位の失敗 ${result.failures.length} 件`);
    }

    writeGithubSummary(
      plan,
      `✅ 取り込み完了: events ${result.eventsUpserted} / occurrences insert ${result.occurrencesInserted} + update ${result.occurrencesUpdated}`,
    );
    console.log('\n✅ 取り込み完了 (冪等 upsert)。');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
