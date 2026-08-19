/**
 * マスタ YAML → seed 実行計画のビルダー (Layer 1 純粋関数)
 *
 * 入力は revolution-templates の 2 ファイルをパースしたオブジェクト:
 * - `title-romaji-mapping.yaml` → titles / title_aliases
 * - `venue-master.yaml`         → venues / venue_aliases
 *
 * DB へは書かず、**upsert すべき行と検出した問題だけ**を返す。
 * 実際の書き込みは `scripts/seed-masters.ts` (Layer 2 境界) が行う。
 *
 * naming doc (`one-more-time/docs/schema/revolution-naming-yaml.md`) §3 ★ の 3 帰結を実装:
 * 1. 正規化で一致する alias は 1 行に集約する (エラーにしない)
 * 2. `name` の正規化形も alias に入れる (正式名でも引けるように)
 * 3. 別エンティティ間で alias が衝突したら seed を止める (collisions として返す)
 */
import { TITLE_KIND_VALUES, TITLE_SLUG_REGEX } from '@revolution/schemas/title';
import { VENUE_SLUG_REGEX } from '@revolution/schemas/venue';

import { normalizeAlias } from './normalize-alias';

// kind / slug の許容値は shared/schemas/{title,venue}.ts の真実源を import する
// (PR #328 レビュー指摘: 再定義すると DB CHECK / zod / 本ファイルの 3 箇所同期が必要になる)
export type TitleKind = (typeof TITLE_KIND_VALUES)[number];

export interface TitleEntryYaml {
  slug: string;
  kind?: string;
  english_title?: string;
  aliases?: string[];
  short_title?: string;
}

export interface TitleRomajiYaml {
  titles: Record<string, string | TitleEntryYaml>;
}

export interface VenueEntryYaml {
  slug: string;
  prefecture?: string;
  city?: string;
  address?: string;
  aliases?: string[];
}

export interface VenueMasterYaml {
  venues: Record<string, VenueEntryYaml>;
}

export interface SeedPlan {
  titles: Array<{ slug: string; name: string; kind: TitleKind }>;
  /** alias は正規化済み。titleSlug で titles 行と結ぶ (id は upsert 後に解決)。 */
  titleAliases: Array<{ alias: string; titleSlug: string }>;
  venues: Array<{
    slug: string;
    name: string;
    prefecture: string | null;
    city: string | null;
    address: string | null;
  }>;
  venueAliases: Array<{ alias: string; venueSlug: string }>;
  /** 別エンティティ間の alias 衝突。1 件でもあれば seed を実行してはいけない。 */
  collisions: Array<{ table: 'title_aliases' | 'venue_aliases'; alias: string; slugs: string[] }>;
  /** slug 形式違反・kind 不正など。1 件でもあれば seed を実行してはいけない。 */
  errors: string[];
}

function isTitleKind(value: string): value is TitleKind {
  return (TITLE_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * alias 集合を構築する共通処理。
 * `aliasToSlug` に既存の割当があり slug が異なれば衝突として記録する。
 */
function collectAliases(
  sourceStrings: string[],
  slug: string,
  aliasToSlug: Map<string, string>,
): { aliases: string[]; collisions: Map<string, Set<string>> } {
  const aliases: string[] = [];
  const collisions = new Map<string, Set<string>>();

  for (const raw of sourceStrings) {
    const normalized = normalizeAlias(raw);
    if (normalized === '') continue;

    const existing = aliasToSlug.get(normalized);
    if (existing === undefined) {
      aliasToSlug.set(normalized, slug);
      aliases.push(normalized);
    } else if (existing !== slug) {
      const set = collisions.get(normalized) ?? new Set([existing]);
      set.add(slug);
      collisions.set(normalized, set);
    }
    // existing === slug は帰結 1 (同一エンティティ内の集約) — 何もしない
  }

  return { aliases, collisions };
}

export function buildMasterSeed(
  titleYaml: TitleRomajiYaml,
  venueYaml: VenueMasterYaml,
): SeedPlan {
  const plan: SeedPlan = {
    titles: [],
    titleAliases: [],
    venues: [],
    venueAliases: [],
    collisions: [],
    errors: [],
  };

  // --- titles: kind を持つエントリだけが seed 対象 (titles.kind が NOT NULL のため) ---
  const titleAliasToSlug = new Map<string, string>();
  for (const [name, entry] of Object.entries(titleYaml.titles)) {
    if (typeof entry === 'string' || entry.kind === undefined) continue;

    if (!isTitleKind(entry.kind)) {
      plan.errors.push(
        `titles["${name}"]: kind "${entry.kind}" は許容値 (${TITLE_KIND_VALUES.join('/')}) 外`,
      );
      continue;
    }
    if (!TITLE_SLUG_REGEX.test(entry.slug)) {
      plan.errors.push(`titles["${name}"]: slug "${entry.slug}" が形式違反`);
      continue;
    }

    plan.titles.push({ slug: entry.slug, name, kind: entry.kind });

    const { aliases, collisions } = collectAliases(
      [name, ...(entry.aliases ?? [])],
      entry.slug,
      titleAliasToSlug,
    );
    plan.titleAliases.push(...aliases.map((alias) => ({ alias, titleSlug: entry.slug })));
    for (const [alias, slugs] of collisions) {
      plan.collisions.push({ table: 'title_aliases', alias, slugs: [...slugs] });
    }
  }

  // --- venues: 全エントリが seed 対象 ---
  const venueAliasToSlug = new Map<string, string>();
  for (const [name, entry] of Object.entries(venueYaml.venues)) {
    if (!VENUE_SLUG_REGEX.test(entry.slug)) {
      plan.errors.push(`venues["${name}"]: slug "${entry.slug}" が形式違反`);
      continue;
    }

    plan.venues.push({
      slug: entry.slug,
      name,
      prefecture: entry.prefecture ?? null,
      city: entry.city ?? null,
      address: entry.address ?? null,
    });

    const { aliases, collisions } = collectAliases(
      [name, ...(entry.aliases ?? [])],
      entry.slug,
      venueAliasToSlug,
    );
    plan.venueAliases.push(...aliases.map((alias) => ({ alias, venueSlug: entry.slug })));
    for (const [alias, slugs] of collisions) {
      plan.collisions.push({ table: 'venue_aliases', alias, slugs: [...slugs] });
    }
  }

  // slug の重複 (同一 slug が別 name で定義) も seed 不能として検出する
  for (const [table, rows] of [
    ['titles', plan.titles.map((t) => t.slug)],
    ['venues', plan.venues.map((v) => v.slug)],
  ] as const) {
    const seen = new Set<string>();
    for (const slug of rows) {
      if (seen.has(slug)) plan.errors.push(`${table}: slug "${slug}" が複数エントリで重複`);
      seen.add(slug);
    }
  }

  return plan;
}
