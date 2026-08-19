/**
 * titles / venues マスタの seed スクリプト (ローカル実行専用、CI には組み込まない)
 *
 * revolution-templates の YAML (真実源) を読み、staging Supabase へ upsert する。
 * S3 (occurrence 取り込み) の案 B「venues マスタを先に seed し venue_aliases で
 * venue_label を解決する」(2026-08-20 BOSS 確定) の前段。
 *
 * 使い方:
 *   TEMPLATES_SOURCE_PATH=/path/to/revolution-templates \
 *   SEED_DATABASE_URL='postgresql://...pooler...:6543/postgres' \
 *   pnpm seed:masters [--dry-run] [--verify]
 *
 * - `SEED_DATABASE_URL` は**あえて専用の env 名**にしている (`DATABASE_URL` に
 *   フォールバックしない)。`.env.local` の値で意図しない DB へ書く事故を防ぐため、
 *   毎回 inline で渡す運用 (lib/db/migrate.ts の MIGRATION_DATABASE_URL と同じ発想)。
 * - `--dry-run`: DB へ接続せず、実行計画 (件数と内訳) だけを表示する
 * - `--verify`: seed 後の検証。article-index.json の全 venue_label / title_slugs が
 *   マスタで解決できるかを DB 照合で報告する (書き込みなし)
 * - 冪等: slug / alias を自然キーに upsert。再実行しても重複しない
 * - 停止条件 (exit 1): YAML の形式違反 / 別エンティティ間 alias 衝突 (naming doc §3 帰結 3) /
 *   既存 alias 行が別エンティティを指している (黙って付け替えない)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { load as yamlLoad } from 'js-yaml';
import postgres from 'postgres';

import { titleAliases } from '@revolution/schemas/db/title-aliases';
import { titles } from '@revolution/schemas/db/titles';
import { venueAliases } from '@revolution/schemas/db/venue-aliases';
import { venues } from '@revolution/schemas/db/venues';

import {
  buildMasterSeed,
  type TitleRomajiYaml,
  type VenueMasterYaml,
} from '../lib/ingest/build-master-seed';
import { normalizeAlias } from '../lib/ingest/normalize-alias';

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

function fail(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function loadYamlFile<T>(path: string): T {
  return yamlLoad(readFileSync(path, 'utf8')) as T;
}

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} が未設定です。${hint}`);
  return value;
}

async function main(): Promise<void> {
  const templatesPath = requireEnv(
    'TEMPLATES_SOURCE_PATH',
    'revolution-templates のローカルパスを inline で渡してください。',
  );
  const configDir = resolve(templatesPath, 'ai-writer/config');

  const titleYaml = loadYamlFile<TitleRomajiYaml>(resolve(configDir, 'title-romaji-mapping.yaml'));
  const venueYaml = loadYamlFile<VenueMasterYaml>(resolve(configDir, 'venue-master.yaml'));

  const plan = buildMasterSeed(titleYaml, venueYaml);

  console.log('--- seed 実行計画 ---');
  console.log(`titles:        ${plan.titles.length} 件 (kind 付きエントリのみ)`);
  console.log(`title_aliases: ${plan.titleAliases.length} 件 (正規化済み)`);
  console.log(`venues:        ${plan.venues.length} 件`);
  console.log(`venue_aliases: ${plan.venueAliases.length} 件 (正規化済み)`);

  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error(`  - ${error}`);
    fail(`YAML の形式違反 ${plan.errors.length} 件。seed を中止します。`);
  }
  if (plan.collisions.length > 0) {
    for (const c of plan.collisions) {
      console.error(`  - ${c.table}: "${c.alias}" が複数エンティティを指す: ${c.slugs.join(', ')}`);
    }
    fail(
      `別エンティティ間の alias 衝突 ${plan.collisions.length} 件 (naming doc §3 帰結 3)。人手で解決してください。`,
    );
  }

  if (DRY_RUN) {
    if (VERIFY) {
      console.log('⚠️ --verify は DB 照合が必要なため --dry-run と併用できません (無視します)');
    }
    console.log('\n(--dry-run のため DB へは接続しません)');
    return;
  }

  const dbUrl = requireEnv(
    'SEED_DATABASE_URL',
    'staging の Session/Transaction pooler URL を inline で渡してください (DATABASE_URL へはフォールバックしません)。',
  );
  const client = postgres(dbUrl, { prepare: false });
  const db = drizzle(client);

  try {
    if (VERIFY) {
      await runVerify(db);
      return;
    }

    await db.transaction(async (tx) => {
      // --- titles (自然キー: slug)。drizzle は values([]) で throw するため空配列を避ける
      // (kind 未付与の YAML で実行した場合など、0 件は正常系) ---
      const titleRows =
        plan.titles.length > 0
          ? await tx
              .insert(titles)
              .values(plan.titles)
              .onConflictDoUpdate({
                target: titles.slug,
                set: { name: sql`excluded.name`, kind: sql`excluded.kind` },
              })
              .returning({ id: titles.id, slug: titles.slug })
          : [];
      const titleIdBySlug = new Map(titleRows.map((r) => [r.slug, r.id]));

      // --- venues (自然キー: slug) ---
      const venueRows =
        plan.venues.length > 0
          ? await tx
              .insert(venues)
              .values(plan.venues)
              .onConflictDoUpdate({
                target: venues.slug,
                set: {
                  name: sql`excluded.name`,
                  prefecture: sql`excluded.prefecture`,
                  city: sql`excluded.city`,
                  address: sql`excluded.address`,
                },
              })
              .returning({ id: venues.id, slug: venues.slug })
          : [];
      const venueIdBySlug = new Map(venueRows.map((r) => [r.slug, r.id]));

      // --- aliases: 既存行が別エンティティを指していたら停止 (黙って付け替えない) ---
      const titleAliasRows = plan.titleAliases.map((a) => ({
        alias: a.alias,
        titleId: titleIdBySlug.get(a.titleSlug)!,
      }));
      const existingTitleAliases = await tx
        .select({ alias: titleAliases.alias, titleId: titleAliases.titleId })
        .from(titleAliases)
        .where(inArray(titleAliases.alias, titleAliasRows.map((a) => a.alias)));
      const titleConflicts = existingTitleAliases.filter((existing) => {
        const planned = titleAliasRows.find((a) => a.alias === existing.alias);
        return planned !== undefined && planned.titleId !== existing.titleId;
      });
      if (titleConflicts.length > 0) {
        throw new Error(
          `title_aliases の既存行が別 title を指しています (付け替えは人手判断): ${titleConflicts
            .map((c) => c.alias)
            .join(', ')}`,
        );
      }
      if (titleAliasRows.length > 0) {
        await tx.insert(titleAliases).values(titleAliasRows).onConflictDoNothing();
      }

      const venueAliasRows = plan.venueAliases.map((a) => ({
        alias: a.alias,
        venueId: venueIdBySlug.get(a.venueSlug)!,
      }));
      const existingVenueAliases = await tx
        .select({ alias: venueAliases.alias, venueId: venueAliases.venueId })
        .from(venueAliases)
        .where(inArray(venueAliases.alias, venueAliasRows.map((a) => a.alias)));
      const venueConflicts = existingVenueAliases.filter((existing) => {
        const planned = venueAliasRows.find((a) => a.alias === existing.alias);
        return planned !== undefined && planned.venueId !== existing.venueId;
      });
      if (venueConflicts.length > 0) {
        throw new Error(
          `venue_aliases の既存行が別 venue を指しています (付け替えは人手判断): ${venueConflicts
            .map((c) => c.alias)
            .join(', ')}`,
        );
      }
      if (venueAliasRows.length > 0) {
        await tx.insert(venueAliases).values(venueAliasRows).onConflictDoNothing();
      }
    });

    console.log('\n✅ seed 完了 (冪等 upsert)。--verify で解決率を確認できます。');
  } finally {
    await client.end();
  }
}

/**
 * article-index.json の全 venue_label / title_slugs がマスタで解決できるかを検証する。
 * S3 ingest と同じ解決順 (slug 直接一致 → 正規化して aliases 一致) を先取りした確認。
 */
async function runVerify(db: ReturnType<typeof drizzle>): Promise<void> {
  interface ArticleIndex {
    articles: Array<{
      slug: string;
      event_data?: {
        title_slugs?: string[];
        occurrences?: Array<{ venue_label: string | null }>;
      };
    }>;
  }
  // pnpm script 経由の実行前提 (cwd = apps/frontend)
  const index = JSON.parse(
    readFileSync(resolve(process.cwd(), 'lib/mdx/article-index.json'), 'utf8'),
  ) as ArticleIndex;

  const titleSlugSet = new Set(
    (await db.select({ slug: titles.slug }).from(titles)).map((r) => r.slug),
  );
  const titleAliasSet = new Set(
    (await db.select({ alias: titleAliases.alias }).from(titleAliases)).map((r) => r.alias),
  );
  const venueAliasSet = new Set(
    (await db.select({ alias: venueAliases.alias }).from(venueAliases)).map((r) => r.alias),
  );

  let unresolved = 0;
  for (const article of index.articles) {
    for (const slug of article.event_data?.title_slugs ?? []) {
      const hit = titleSlugSet.has(slug) || titleAliasSet.has(normalizeAlias(slug));
      if (!hit) {
        unresolved += 1;
        console.log(`  ✗ title 未解決: "${slug}" (記事 ${article.slug})`);
      }
    }
    for (const occurrence of article.event_data?.occurrences ?? []) {
      if (occurrence.venue_label === null) continue;
      const hit = venueAliasSet.has(normalizeAlias(occurrence.venue_label));
      if (!hit) {
        unresolved += 1;
        console.log(`  ✗ venue 未解決: "${occurrence.venue_label}" (記事 ${article.slug})`);
      }
    }
  }

  if (unresolved === 0) {
    console.log('\n✅ verify: article-index.json の title / venue はすべて解決できます。');
  } else {
    console.log(
      `\n⚠️ verify: 未解決 ${unresolved} 件。取り込み時は人手キューへ落ちます (期待値: OH MY CAFE の 1 件)。`,
    );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
