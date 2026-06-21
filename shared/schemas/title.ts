import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { titles } from './db/titles';

/**
 * Schema-SDD 真実源: titles の zod 契約 (Layer1)
 *
 * titles master の slug / name / kind のバリデーション真実源。AI Writer /
 * Frontend から再利用される。
 *
 * - `TITLE_SLUG_REGEX` は URL 正準を守る制約。`shared/schemas/db/titles.ts`
 *   の DB UNIQUE + CHECK と二段防御を構成し、Layer1 zod がフォーマットの真実源。
 * - `TITLE_KIND_VALUES` は kind の許容値の真実源 (DB CHECK と二段防御)。
 * - select / insert の zod 派生は drizzle-zod でテーブル定義から生成し、
 *   slug に regex / name に min(1) / kind に enum を refine で乗せる。
 * - canonical 型として export するのは `Title` (= select 推論) のみ。
 *   insert 推論型は Drizzle 側 (`TitleInsert` in `db/titles.ts`) を
 *   利用する (Zod 側に TitleInsert を作らないことで同名 type 衝突を回避、
 *   Phase 1 categories と同パターン)。
 */

/**
 * URL 正準 slug の正規表現 (真実源)。ASCII lowercase + 数字 + ハイフンのみ。
 * 大文字・日本語・スペース・アンダースコアは禁止 (URL 安全 + Phase 1 categories
 * と整合)。
 */
export const TITLE_SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * kind の許容値 (真実源)。`db/titles.ts` の CHECK 制約と二段防御。
 *
 * 値追加時は本 const と DB CHECK 両方を更新する必要がある (Layer 1 / Layer 2
 * の同期は migration + drizzle-zod 再生成のセットで保証)。
 */
export const TITLE_KIND_VALUES = [
  'anime',
  'manga',
  'game',
  'novel',
  'other',
] as const;

/**
 * titles 行の select スキーマ。DB の NOT NULL 制約 (slug / name / kind /
 * created_at) と nullable (name_kana) をそのまま zod 側でも保持する。
 */
export const TitleSchema = createSelectSchema(titles);

/**
 * titles の insert スキーマ。AI Writer / 管理スクリプト等が新規 master 行を
 * 投入する際に使う。
 *
 * - slug: ASCII lowercase + ハイフンのみ
 * - name: 空文字を許容しない (`min(1)`)
 * - name_kana: 任意。明示 null OK (DB nullable)
 * - kind: `TITLE_KIND_VALUES` の literal union
 */
export const TitleInsertSchema = createInsertSchema(titles, {
  slug: z.string().regex(TITLE_SLUG_REGEX, 'ASCII lowercase + hyphen only'),
  name: z.string().min(1, 'name required'),
  nameKana: z.string().nullable().optional(),
  kind: z.enum(TITLE_KIND_VALUES),
});

export type Title = z.infer<typeof TitleSchema>;
