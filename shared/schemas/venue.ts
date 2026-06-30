import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { venues } from './db/venues';

/**
 * Schema-SDD 真実源: venues の zod 契約 (Layer1)
 *
 * venues master の slug / name / prefecture / city / address / geo のバリデーション
 * 真実源。AI Writer / Frontend から再利用される。
 *
 * - `VENUE_SLUG_REGEX` は URL 正準を守る制約。`shared/schemas/db/venues.ts`
 *   の DB UNIQUE + CHECK と二段防御を構成し、Layer1 zod がフォーマットの真実源。
 *   先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全、Phase 2-a 継承)。
 * - select / insert の zod 派生は drizzle-zod でテーブル定義から生成し、
 *   slug に regex / name に trim+min(1) / prefecture / city / address に
 *   non-empty + nullable + optional を refine で乗せる。
 * - `geo` 列の値検証は zod では行わない (customType 由来、WKT/WKB 文字列を
 *   AI Writer 側で投入する想定。DB 側の `geography(point, 4326)` 型と PostGIS
 *   関数で検証)。
 * - canonical 型として export するのは `Venue` (= select 推論) のみ。
 *   insert 推論型は Drizzle 側 (`VenueInsert` in `db/venues.ts`) を
 *   利用する (Zod 側に VenueInsert を作らないことで同名 type 衝突を回避、
 *   Phase 1 categories / Phase 2-a titles と同パターン)。
 */

/**
 * URL 正準 slug の正規表現 (真実源)。ASCII lowercase + 数字 + ハイフンのみ。
 * 先頭/末尾/連続ハイフン (`-foo` / `foo-` / `foo--bar`) は URL 正準化の観点で
 * 禁止 (大文字・日本語・スペース・アンダースコアも禁止)。Phase 2-a
 * `TITLE_SLUG_REGEX` と同パターン。
 */
export const VENUE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * venues 行の select スキーマ。DB の NOT NULL 制約 (slug / name / created_at)
 * と nullable (prefecture / city / address / geo) をそのまま zod 側でも保持する。
 */
export const VenueSchema = createSelectSchema(venues);

/**
 * venues の insert スキーマ。AI Writer / 管理スクリプト等が新規 master 行を
 * 投入する際に使う。
 *
 * - slug: ASCII lowercase + ハイフンのみ + 先頭/末尾/連続ハイフン禁止
 * - name: trim 後に空でない (`'   '` を拒否)
 * - prefecture / city / address: 任意 (null/undefined OK)。値ありの場合は
 *   空文字拒否 (`''` を拒否)、Phase 2-a の `name_kana` と同パターン
 * - geo: zod refine の対象外 (customType 由来、AI Writer 側で WKT/WKB を投入)
 */
export const VenueInsertSchema = createInsertSchema(venues, {
  slug: z
    .string()
    .regex(
      VENUE_SLUG_REGEX,
      'ASCII lowercase + hyphen, no leading/trailing/consecutive hyphen',
    ),
  name: z.string().trim().min(1, 'name required (non-blank)'),
  prefecture: z
    .string()
    .min(1, 'prefecture must be non-empty when present')
    .nullable()
    .optional(),
  city: z
    .string()
    .min(1, 'city must be non-empty when present')
    .nullable()
    .optional(),
  address: z
    .string()
    .min(1, 'address must be non-empty when present')
    .nullable()
    .optional(),
});

export type Venue = z.infer<typeof VenueSchema>;
