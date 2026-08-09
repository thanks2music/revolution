import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { events } from './events';
import { venues } from './venues';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.occurrences
 *
 * 開催 master テーブル (LiveFans の「公演」相当・永続)。1 企画 (`events`) =
 * N 開催 (会場 × 期間)。**レビューの紐付け先はこのテーブル**であり、
 * `reviews.occurrence_id` が FK で参照する。
 *
 * 設計判断 (S0「設計確定」2026-08-02〜08-03、一次資料
 * `one-more-time/docs/schema/revolution-schema.ts` + `revolution-er-v3.md`):
 * - `id` は `bigint generated always as identity` の代理キー (categories /
 *   titles / venues / events と同パターン)。
 * - `venue_id` は **nullable** (オンライン開催は会場を持たない)。マスタ化しない
 *   一時会場は `venue_label` に表示名だけを持つ。ON DELETE restrict = 会場を
 *   消して開催が浮くのを防ぐ (venues は永続マスタ)。
 * - `slug` は **NOT NULL** (★決定③)。v3 の nullable を撤回した。PostgreSQL は
 *   NULL != NULL として扱うため `slug = null` の行は
 *   `occurrences_event_slug_uniq` をすり抜けて無制限に共存できてしまう。
 *   会場名が取れず採番できない記事は occurrence を作らず取り込み保留 → 人手
 *   キューへ回す (★決定⑧ の品質ゲートと統合)。
 * - `ends_on` は **nullable** (★決定⑤)。null = 「終了日未定 / 常設」。v3 は
 *   starts_on / ends_on とも NOT NULL で常設型を表現できなかった。実データで
 *   「ちいかわレストラン」等の通年営業を確認済 (parco.jp)。
 * - `verified` は取り込み品質ゲート (★決定⑧)。false の間はページに出さない。
 *   **RLS の公開判定が本カラムに依存する** (`occurrences_select_verified`)。
 *   既知エンティティに完全一致すれば自動 true、新規 title / venue が発生した
 *   場合のみ人手承認。
 * - `rating_sum` / `rating_count` は開催単位の集計キャッシュ。`events` 側にも
 *   同名カラムがあり、`private.apply_review_delta()` が **両方**を update する
 *   (★決定① = (b) 現行の非正規化トリガを追認)。平均は持たず sum/count を
 *   ロールアップするため、企画平均が件数で正しく加重される。
 * - `status` カラムは**持たない**。開催状態は日付から導出する
 *   (`public.occurrence_view`、JST 固定)。中止だけ `cancelled_at` で実体保持。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK、events / venues / titles 継承):
 *   slug:
 *     Layer1 = zod (`shared/schemas/occurrence.ts`、`OCCURRENCE_SLUG_REGEX`)
 *     Layer2 = DB CHECK (本ファイル、Layer 1 と同正規表現)
 *   venue_label:
 *     Layer1 = zod (`.min(1).nullable().optional()`)
 *     Layer2 = DB CHECK (NULL or `btrim(..., E' \t\n\r　') <> ''`、Unicode-aware)
 *   日付:
 *     Layer2 のみ = `ends_on is null or ends_on >= starts_on`
 *
 * ★ slug format / venue_label not_blank の CHECK は **S0 一次資料
 *   (`revolution-schema.ts`) には無かった**が、既存 4 テーブル
 *   (categories / titles / venues / events) が全て slug regex + not_blank を
 *   持つため、規約を揃える判断で 0013 で追加した (BOSS 承認 2026-08-06)。
 *   `btrim` の charset は events と同じ Unicode-aware 版
 *   (`E' \t\n\r　'`、PR #260 Backlog C の R2 教訓)。
 *
 * RLS / GRANT / トリガ / `occurrence_view` は同じ migration (0013) の custom
 * SQL で付与する (drizzle pgTable に enableRls は付与せず、既存テーブルと同様)。
 */
export const occurrences = pgTable(
  'occurrences',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    // オンライン開催は null。ON DELETE restrict で会場の巻き添え削除を防ぐ。
    venueId: bigint('venue_id', { mode: 'number' }).references(() => venues.id, {
      onDelete: 'restrict',
    }),
    // マスタ化しない一時会場の表示名。
    venueLabel: text('venue_label'),
    // URL 用。企画内で会場を表す。例 'tokyo-omotesando'。★決定③ で NOT NULL 化。
    slug: text('slug').notNull(),
    // ★ 2026-08-09: NOT NULL を外した (BOSS 確定)。日付未発表の開催を保存するため。
    //   A-1-c (段階的発表) が「日付欠落を正常な状態として upsert できる必要がある」と
    //   定めているのに NOT NULL で矛盾しており、LLM 側で日付の捏造を誘発していた。
    //   `occurrence_view` に `starts_on is null → '日程未定'` の分岐を同時に追加している
    //   (分岐がないと NULL が else に落ちて「開催中」と誤表示される)。
    startsOn: date('starts_on'),
    // ★決定⑤: null = 終了日未定 / 常設。
    endsOn: date('ends_on'),
    // 中止のみ実体保持 (status カラムは持たず日付から導出)。
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // ★決定⑧: 取り込み品質ゲート。RLS の公開判定が依存する。
    verified: boolean('verified').notNull().default(false),
    // 開催単位の集計キャッシュ (events 側にも同名カラムあり、トリガが両方更新)。
    ratingSum: bigint('rating_sum', { mode: 'number' }).notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ★ `event_id` 単独の index は **置かない**。下の
    //   `occurrences_event_slug_uniq (event_id, slug)` の leftmost prefix が
    //   `where event_id = ?` と `events` 削除時の ON DELETE CASCADE の両方を
    //   賄えることを EXPLAIN で実測確認済み (2026-08-06)。
    //   `review_helpful_user_idx` / `event_categories_category_idx` を置いて
    //   いるのは、あちらが複合 index の **2 列目** で leftmost prefix に
    //   該当しないため。ここは該当するので冗長になる
    //   (`/supabase-postgres-best-practices` query-composite-indexes)。
    index('occurrences_venue_idx').on(table.venueId),
    // 状態導出 (開催中 / 予定 / 終了) の範囲検索用。
    index('occurrences_dates_idx').on(table.startsOn, table.endsOn),
    // 企画内で会場 slug を一意に (/events/{event}/{occurrence-slug} の安定化)。
    uniqueIndex('occurrences_event_slug_uniq').on(table.eventId, table.slug),
    // Layer2: DB CHECK。既存 4 テーブルと同正規表現 (BOSS 承認 2026-08-06)。
    check('occurrences_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // Layer2: DB CHECK。venue_label は NULL or 非空白文字列 (Unicode-aware)。
    check(
      'occurrences_venue_label_not_blank',
      sql`${table.venueLabel} is null or btrim(${table.venueLabel}, E' \t\n\r　') <> ''`,
    ),
    // ★決定⑤: ends_on の nullable 化に伴い null を許す条件へ。
    // `null >= x` は NULL を返し CHECK は通るが、意図を明示するため `is null or`
    // を書く (可読性 + 将来 NOT NULL に戻した際の安全性)。
    check(
      'occurrences_dates_chk',
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
  ],
);

export type OccurrenceRow = typeof occurrences.$inferSelect;
export type OccurrenceInsert = typeof occurrences.$inferInsert;
