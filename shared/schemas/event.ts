import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { eventCategories } from './db/event-categories';
import { eventTitles } from './db/event-titles';
import { events } from './db/events';

/**
 * Schema-SDD 真実源: events + event_titles + event_categories の zod 契約 (Layer1)
 *
 * events master + M:N テーブル 2 本のバリデーション真実源。AI Writer / Frontend
 * から再利用される。Sprint B (MVP 第 2 段階) の中核 3 テーブルを 1 ファイルに
 * 集約 (events + M:N ペアは常に一緒に扱うため、Phase 2-a titles 単独と異なり
 * 個別 file 分割せず 1 file で管理)。
 *
 * - `EVENT_SLUG_REGEX` は URL 正準を守る制約。`shared/schemas/db/events.ts` の
 *   DB UNIQUE + CHECK と二段防御を構成し、Layer1 zod がフォーマットの真実源。
 *   先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全)。
 * - select / insert の zod 派生は drizzle-zod でテーブル定義から生成し、slug に
 *   regex / name に trim+min(1) / official_url に URL 検証 / description に
 *   nullable を乗せる。
 * - canonical 型として export するのは `Event` (= select 推論) のみ。insert 推論
 *   型は Drizzle 側 (`EventInsert` in `db/events.ts`) を利用する (Zod 側に
 *   EventInsert を作らないことで同名 type 衝突を回避、Phase 1/2-a と同パターン)。
 * - M:N テーブル (event_titles / event_categories) は insert 型のみ zod 化 (select
 *   型はほぼ使用場面がないため YAGNI で省略)。composite PK と FK 制約は Layer 2
 *   のみで保証。
 */

/**
 * URL 正準 slug の正規表現 (真実源)。ASCII lowercase + 数字 + ハイフンのみ。
 * 先頭/末尾/連続ハイフン (`-foo` / `foo-` / `foo--bar`) は URL 正準化の観点で
 * 禁止 (大文字・日本語・スペース・アンダースコアも禁止)。
 *
 * TITLE_SLUG_REGEX / VENUE_SLUG_REGEX / CATEGORY_SLUG_REGEX と同一パターン。
 * 4 つ目のテーブルで同 regex を使う時点で `shared/schemas/_shared/slug.ts` へ
 * 抽出する (rule-of-3、現時点は各ファイル個別宣言、SoC 内明示のため冗長許容)。
 */
export const EVENT_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * events 行の select スキーマ。DB の NOT NULL 制約 (slug / name /
 * primary_category_id / rating_sum / rating_count / created_at) と nullable
 * (description / official_url) をそのまま zod 側でも保持する。
 */
export const EventSchema = createSelectSchema(events);

/**
 * events の insert スキーマ。AI Writer / 管理スクリプト等が新規 master 行を投入
 * する際に使う。
 *
 * - slug: ASCII lowercase + ハイフンのみ + 先頭/末尾/連続ハイフン禁止
 * - name: trim 後に空でない (`'   '` を拒否、`'　'` (U+3000) も拒否 = trim は
 *   Zod 側で ASCII 空白のみ除去だが、DB CHECK が Unicode-aware で U+3000 も
 *   拒否する二段防御)
 * - primary_category_id: NOT NULL (FK to categories.id)、追加検証は不要
 * - description: 任意 (null/undefined OK)、空文字も許容 (DB CHECK なし)
 * - official_url: 任意 (null/undefined OK)。値ありの場合は URL 形式必須 (Zod
 *   `.url()`)。DB CHECK は形式検証しないが空白拒否のみ (Unicode-aware)。
 * - rating_sum / rating_count: default 0、Layer 1 では明示バリデーション不要
 * - created_at: default now()、Layer 1 では明示バリデーション不要
 */
export const EventInsertSchema = createInsertSchema(events, {
  slug: z
    .string()
    .regex(EVENT_SLUG_REGEX, 'ASCII lowercase + hyphen, no leading/trailing/consecutive hyphen'),
  name: z.string().trim().min(1, 'name required (non-blank)'),
  description: z.string().nullable().optional(),
  officialUrl: z.string().url('official_url must be a valid URL').nullable().optional(),
});

/**
 * event_titles の insert スキーマ (M:N events↔titles)。
 * composite PK (event_id, title_id) の重複拒否は Layer 2、Zod は型・存在確認のみ。
 */
export const EventTitleInsertSchema = createInsertSchema(eventTitles);

/**
 * event_categories の insert スキーマ (M:N events↔categories、補助タグ用)。
 * composite PK (event_id, category_id) の重複拒否は Layer 2、Zod は型・存在確認のみ。
 */
export const EventCategoryInsertSchema = createInsertSchema(eventCategories);

/**
 * canonical select 型。AI Writer / Frontend で events row を扱う際の型。
 */
export type Event = z.infer<typeof EventSchema>;
