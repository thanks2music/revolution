import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { titleAliases } from './db/title-aliases';
import { venueAliases } from './db/venue-aliases';

/**
 * Schema-SDD 真実源: title_aliases + venue_aliases の zod 契約 (Layer1)
 *
 * 名寄せ (エンティティ解決) 補助の 2 テーブルを 1 ファイルに集約する
 * (対になる設計で、判断を分岐させないため)。
 *
 * ★ **真実源は YAML**、DB は **seed 先** (2026-08-03 BOSS 確定)。
 *   正規化規約の一次資料: `one-more-time/docs/schema/revolution-naming-yaml.md` §4-4
 *   本 zod は「seed 投入時に壊れた値が入らないこと」を守るのが役割で、
 *   **正規化そのものを行うものではない** (正規化は投入前に済ませる)。
 *
 * ★ 両テーブルとも **非公開** (RLS 有効 + policy なし + anon/authenticated から
 *   REVOKE ALL)。読み書きは service_role のみ。
 *
 * slug 系テーブルと違い `alias` に**形式の正規表現を掛けない**。別名は
 * 「じゅじゅつかいせん」「JUJUTSU KAISEN」「表参道ヒルズ B3」のような
 * 実世界の表記そのもので、ASCII slug の制約を課すと名寄せの対象を取りこぼす。
 * Layer 1 で守るのは「空白のみでないこと」だけ (DB CHECK と二段防御)。
 */

/** title_aliases 行の select スキーマ。 */
export const TitleAliasSchema = createSelectSchema(titleAliases);

/**
 * title_aliases の insert スキーマ。
 *
 * - alias: **正規化済みの別名**を入れる (PK)。空白のみは拒否。
 * - title_id: 正準 `titles.id`。
 */
export const TitleAliasInsertSchema = createInsertSchema(titleAliases, {
  alias: z.string().trim().min(1, 'alias must be non-blank'),
});

/** venue_aliases 行の select スキーマ。 */
export const VenueAliasSchema = createSelectSchema(venueAliases);

/**
 * venue_aliases の insert スキーマ。title_aliases と同一方針。
 *
 * - alias: 正規化済みの別名 (PK)。空白のみは拒否。
 * - venue_id: 正準 `venues.id`。
 */
export const VenueAliasInsertSchema = createInsertSchema(venueAliases, {
  alias: z.string().trim().min(1, 'alias must be non-blank'),
});

/** canonical select 型。 */
export type TitleAlias = z.infer<typeof TitleAliasSchema>;
export type VenueAlias = z.infer<typeof VenueAliasSchema>;
