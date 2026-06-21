import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { categories } from './db/categories';

/**
 * Schema-SDD 真実源: categories の zod 契約 (Layer1)
 *
 * categories master の slug / name のバリデーション真実源。AI Writer / Frontend
 * から再利用される。
 *
 * - `CATEGORY_SLUG_REGEX` は URL 正準を守る制約。`shared/schemas/db/categories.ts`
 *   の DB UNIQUE + CHECK と二段防御を構成し、Layer1 zod がフォーマットの真実源。
 *   先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全)。
 * - select / insert の zod 派生は drizzle-zod でテーブル定義から生成し、
 *   slug に regex / name に trim+min(1) を refine で乗せる。
 * - canonical 型として export するのは `Category` (= select 推論) のみ。
 *   insert 推論型は Drizzle 側 (`CategoryInsert` in `db/categories.ts`) を
 *   利用する (Zod 側に CategoryInsert を作らないことで同名 type 衝突を回避)。
 */

/**
 * URL 正準 slug の正規表現 (真実源)。ASCII lowercase + 数字 + ハイフンのみ。
 * 先頭/末尾/連続ハイフン (`-foo` / `foo-` / `foo--bar`) は URL 正準化の観点で
 * 禁止 (大文字・日本語・スペース・アンダースコアも禁止、URL 安全 + AI Writer の
 * `event-type-slugs.yaml` 出力フォーマットと整合)。
 */
export const CATEGORY_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * categories 行の select スキーマ。DB の NOT NULL 制約 (slug / name) を
 * そのまま zod 側でも保持する。
 */
export const CategorySchema = createSelectSchema(categories);

/**
 * categories の insert スキーマ。AI Writer / 管理スクリプト等が新規 master
 * 行を投入する際に使う。
 *
 * - slug: ASCII lowercase + ハイフンのみ + 先頭/末尾/連続ハイフン禁止
 * - name: trim 後に空でない (`'   '` を拒否)
 */
export const CategoryInsertSchema = createInsertSchema(categories, {
  slug: z.string().regex(CATEGORY_SLUG_REGEX, 'ASCII lowercase + hyphen, no leading/trailing/consecutive hyphen'),
  name: z.string().trim().min(1, 'name required (non-blank)'),
});

export type Category = z.infer<typeof CategorySchema>;
