import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { occurrences } from './db/occurrences';

/**
 * Schema-SDD 真実源: occurrences の zod 契約 (Layer1)
 *
 * 開催 (会場 × 期間) のバリデーション真実源。AI Writer の取り込みパイプライン
 * (S3) と Frontend の開催ページ (S2) から再利用される。
 *
 * - `OCCURRENCE_SLUG_REGEX` は URL 正準を守る制約。`db/occurrences.ts` の
 *   DB CHECK + `occurrences_event_slug_uniq` と二段防御を構成し、Layer1 zod が
 *   フォーマットの真実源。
 * - canonical 型として export するのは `Occurrence` (= select 推論) のみ。
 *   insert 推論型は Drizzle 側 (`OccurrenceInsert` in `db/occurrences.ts`) を
 *   使う (同名 type 衝突の回避、Phase 1 / 2-a / Sprint B と同パターン)。
 * - `OccurrenceViewSchema` は **`public.occurrence_view` の契約**。テーブルでは
 *   なく view のため drizzle-zod では生成できず、select スキーマに `status` を
 *   足す形で表現する。
 */

/**
 * URL 正準 slug の正規表現 (真実源)。ASCII lowercase + 数字 + ハイフンのみ。
 * 先頭 / 末尾 / 連続ハイフンは URL 正準化の観点で禁止。
 *
 * CATEGORY / TITLE / VENUE / EVENT_SLUG_REGEX と同一パターン。
 * ★ 5 つ目の重複となるため `shared/schemas/_shared/slug.ts` への抽出は既に
 *   rule-of-3 を超えている (Backlog `6h3RJXv3P79mhcw8`)。本 migration では
 *   スコープを広げず既存 4 テーブルと同じ形で置き、抽出は当該 Backlog に委ねる。
 */
export const OCCURRENCE_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `occurrence_view` が返す状態。**保存せず日付から導出**する (JST 固定)。
 * - `cancelled`: `cancelled_at` が入っている (中止)
 * - `scheduled`: 開催前
 * - `ongoing`  : 開催中。**`ends_on is null` (終了日未定 / 常設) もここに入る**
 * - `ended`    : 終了
 */
export const OCCURRENCE_STATUS_VALUES = ['scheduled', 'ongoing', 'ended', 'cancelled'] as const;

export const OccurrenceStatusSchema = z.enum(OCCURRENCE_STATUS_VALUES);

/**
 * occurrences 行の select スキーマ。DB の NOT NULL / nullable をそのまま保持する。
 * `ends_on` が nullable なのは ★決定⑤ (終了日未定 / 常設) のため。
 */
export const OccurrenceSchema = createSelectSchema(occurrences);

/**
 * occurrences の insert スキーマ。取り込みパイプライン (service_role) が使う。
 *
 * - slug: ★決定③ で NOT NULL。ASCII lowercase + ハイフンのみ。
 *   **採番できない記事は occurrence を作らず取り込み保留 → 人手キューへ回す**
 *   (決定⑧ の品質ゲートと統合) ため、ここで緩めてはいけない。
 * - starts_on: NOT NULL。`z.iso.date()` (zod v4) は単純な regex と違い
 *   月 (01-12) と日 (該当月の最大日) のレンジ違反 (例 `2026-13-45` / `2026-02-30`)
 *   も拒否する。`mdx-frontmatter.ts` の `event_start_date` と同じ作法。
 * - ends_on: ★決定⑤ で nullable (null = 終了日未定 / 常設)。
 *   `ends_on >= starts_on` の関係は Layer 2 の CHECK が担保する
 *   (Layer 1 では単一フィールドの形式のみを見る)。
 * - venue_id: オンライン開催では null。
 * - venue_label: 任意。値ありなら空白のみを拒否 (DB CHECK と二段防御)。
 *
 * ⚠️ `verified` は **Layer 1 では既定値を補完しない**。DB 側に `default false` が
 *    あるため drizzle-zod は「任意」として扱うだけで、省略して parse すると
 *    `undefined` のまま返る (実測)。false を保証しているのは **Layer 2 の
 *    `default false`** であって本スキーマではない。
 *    (2026-08-06 claude[bot] 指摘で訂正。旧 docstring は「Layer 1 でも既定を
 *     false に保つ」と書いていたが事実と異なっていた)
 */
export const OccurrenceInsertSchema = createInsertSchema(occurrences, {
  slug: z
    .string()
    .regex(
      OCCURRENCE_SLUG_REGEX,
      'ASCII lowercase + hyphen, no leading/trailing/consecutive hyphen',
    ),
  startsOn: z.iso.date(),
  endsOn: z.iso.date().nullable().optional(),
  venueLabel: z.string().trim().min(1, 'venue_label must be non-blank').nullable().optional(),
});

/**
 * `public.occurrence_view` の契約 (select 専用)。
 * 基底テーブルの全列 + 導出された `status`。
 *
 * ⚠️ view は `security_invoker = on` で作られているため、**anon /
 * authenticated から読むと `occurrences_select_verified` が効いて
 * `verified = true` の行しか返らない**。service_role で読むと未承認も返る
 * (承認キューの用途)。呼び出し元のロールで結果が変わる点に注意。
 */
export const OccurrenceViewSchema = OccurrenceSchema.extend({
  status: OccurrenceStatusSchema,
});

/** canonical select 型。occurrences row を扱う際の型。 */
export type Occurrence = z.infer<typeof OccurrenceSchema>;

/** `occurrence_view` の行の型 (status 付き)。 */
export type OccurrenceView = z.infer<typeof OccurrenceViewSchema>;

/** 開催状態の型。 */
export type OccurrenceStatus = z.infer<typeof OccurrenceStatusSchema>;
