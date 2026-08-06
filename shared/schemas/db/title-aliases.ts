import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text } from 'drizzle-orm/pg-core';

import { titles } from './titles';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.title_aliases
 *
 * 名寄せ補助: 作品の別名 → 正準 `titles.id`。
 * 「鬼滅の刃 / JUJUTSU KAISEN / じゅじゅつかいせん」のような表記ゆれを
 * 正規化して `titles.id` へマッピングする。
 *
 * ★ **真実源は YAML** (`revolution-templates/ai-writer/config/*.yaml`)、
 *   DB は **seed 先**である (2026-08-03 BOSS 確定)。DB を直接編集して増やす
 *   運用はしない。正規化規約は
 *   `one-more-time/docs/schema/revolution-naming-yaml.md` §4-4 が一次資料。
 *
 * 設計判断:
 * - PK は `alias` 単体 (正規化済みの別名が一意)。代理キーを置かない。
 * - `title_id` は ON DELETE cascade (作品が消えたら別名も消える)。
 * - ★ `title_aliases_title_idx` は **必須**。PK が `alias` のため FK 列は
 *   未 index になり、`titles` 削除時の ON DELETE CASCADE が全件スキャンになる
 *   (Supabase 公式規則 schema-foreign-key-indexes、impact HIGH)。名寄せ辞書は
 *   `title-romaji-mapping.yaml` だけで 1,148 行あり今後も増える。
 *
 * ★ **非公開** (2026-08-03 BOSS 確定): RLS を有効化し policy を作らない
 *   = anon / authenticated からは 0 行。service_role は BYPASSRLS のため影響
 *   なし。公開しない理由 = 名寄せ辞書は蓄積した資産であり、PostgREST 経由で
 *   全件ダンプできる状態にする必要が現時点でない。frontend は Server
 *   Component / SSG から service_role で読むため、ブラウザに直接読ませる用途が
 *   ない。将来クライアント側で alias 検索したくなったら select policy を足す
 *   だけでよく、後戻りのコストは小さい (非破壊的な変更)。
 *
 * 二段防御:
 *   alias:
 *     Layer1 = zod (`shared/schemas/title-alias.ts`、`.min(1)`)
 *     Layer2 = DB CHECK (`btrim(..., E' \t\n\r　') <> ''`、Unicode-aware)
 */
export const titleAliases = pgTable(
  'title_aliases',
  {
    // 正規化済みの別名 (例 'jujutsukaisen' / 'じゅじゅつかいせん')。
    alias: text('alias').primaryKey(),
    titleId: bigint('title_id', { mode: 'number' })
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
  },
  (table) => [
    // ★ PK が alias のため FK 列は未 index。CASCADE の全件スキャンを防ぐ。
    index('title_aliases_title_idx').on(table.titleId),
    check('title_aliases_alias_not_blank', sql`btrim(${table.alias}, E' \t\n\r　') <> ''`),
  ],
);

export type TitleAliasRow = typeof titleAliases.$inferSelect;
export type TitleAliasInsert = typeof titleAliases.$inferInsert;
