import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { categories } from './categories';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.events
 *
 * 企画 master テーブル (LiveFans の「ツアー」相当・永続)。1 企画 = 複数開催
 * (会場×期間) を束ねる公開ページを持つ。event_titles / event_categories と
 * M:N で連携し、Sprint C の occurrences (開催) から FK で参照される。
 *
 * 設計判断 (MVP「Around the World」§11 データモデル基盤先行統合、Sprint B
 * handoff `2026-07-05-mvp-events-sprint-b-handoff.md`、BOSS 承認済プラン
 * `~/.claude/plans/refactored-doodling-token.md`):
 * - `id` は `bigint generated always as identity` の代理キー (categories /
 *   titles / venues と同パターン)。slug は URL に現れるため変更されうるが、
 *   occurrences / event_titles / event_categories からの FK は ID で張る。
 * - `slug` は URL 正準。ASCII lowercase + 数字 + ハイフンのみ。先頭/末尾/連続
 *   ハイフン禁止 (Phase 2-a titles / Phase 2-b venues と同正規表現)。
 * - `name` は日本語の企画名。空白のみは表示が壊れるため拒否。
 * - `primary_category_id` は URL 正準セグメント (例: `/collabo-cafe`) を決める
 *   主分類 FK。**NOT NULL 直接** (Sprint A で categories 23 seed 完了済 + events
 *   は空 seed = migration 適用時に既存行なし、判断 #1)。ON DELETE 未指定 = デフォ
 *   ルト NO ACTION (categories 削除禁止、master 一貫性維持)。event_categories
 *   (M:N 補助タグ) と重複可 = 「主分類 + 補助タグ」設計 (event-review-data-model.md §6)。
 * - `description` は企画説明 (任意、NULL 可、空文字許容 = 詳細空の企画もあり得る)。
 * - `official_url` は企画の公式サイト (任意、NULL 可、値ありなら空白拒否)。
 * - `rating_sum` / `rating_count` は企画全体の集計キャッシュ (全開催のレビューを
 *   sum/count でロールアップ、SSoT :129-130 準拠)。**Sprint C occurrences 導入時
 *   に schema 変更なしで拡張可能 = 前方互換** (判断 #2)。空 seed のため dead
 *   column の実害ゼロ、`default 0` で安全。
 * - `created_at` は SSoT v3 全テーブル共通の運用パターン (profiles / categories
 *   / titles / venues / events / occurrences / reviews) を踏襲。
 *
 * 二段防御 (Layer 1 zod + Layer 2 DB CHECK、Backlog A/B 教訓の initial 適用、判断 #4):
 *   slug:
 *     Layer1 = zod (`shared/schemas/event.ts`、`EVENT_SLUG_REGEX` が真実源)
 *     Layer2 = DB CHECK (本ファイル、Layer 1 と同正規表現)
 *   name:
 *     Layer1 = zod (`.trim().min(1)`、`.trim()` は ECMAScript WhiteSpace の
 *                   U+3000 を含む Unicode 空白全般を除去する)
 *     Layer2 = DB CHECK (`btrim(name, E' \t\n\r　') <> ''`、Unicode charset を
 *                        明示指定して Postgres 直 INSERT / migration 経路の
 *                        全角空白のみ入力を Layer 1 未経由でも拒否)
 *   official_url:
 *     Layer1 = zod (`z.string().url().nullable().optional()`)
 *     Layer2 = DB CHECK (NULL or `btrim(official_url, E' \t\n\r　') <> ''`)
 *
 * PR #260 (Backlog C) レビュー R2 の defense-in-depth 教訓を initial 適用:
 * PostgreSQL の `btrim(text)` (charset 引数なし) は ASCII 空白のみ除去 = U+3000
 * (全角スペース) を素通しする Layer 2 弱点を、明示 charset `E' \t\n\r　'`
 * (半角SP/タブ/改行/全角SP) で回避する。categories / titles / venues 側は
 * 既存 Backlog `6h2Jg5HH9v95C348` / `6h2Jg5GQ9QrM9qc8` で個別処理予定
 * (retrofit ALTER)。events は最初から Unicode-aware で入れる。
 *
 * 注: JS/ECMAScript の `String.prototype.trim()` は WhiteSpace production に
 * U+3000 を含むため、Layer 1 の `.trim().min(1)` の時点で全角スペースのみの
 * name は既に拒否される。Layer 2 CHECK の Unicode-aware charset は SoC 上の
 * 二段防御 (Postgres 側 raw INSERT / トリガー / migration での経路も守る)
 * として意味を持つ (PR #261 claude[bot] R1 Finding 2 の指摘を反映)。
 *
 * RLS は同じ migration (`<timestamp>_events.sql`) で `enable row level security` +
 * SELECT 公開 policy 1 本だけを付与する (anon/authenticated に読み取り公開、書き込
 * みは service role のみ)。drizzle pgTable に enableRls は付与せず、categories /
 * titles / venues と同様 custom SQL 管理。
 *
 * canonical-key.ts (AI Writer 重複判定 Firestore key、`{workSlug}:{storeSlug}:
 * {eventType}:{year}`) との bridging は Sprint C (AI Writer upsert 実装時) に判断
 * (判断 #3、Sprint B スコープ外)。
 */
export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    primaryCategoryId: bigint('primary_category_id', { mode: 'number' })
      .notNull()
      .references(() => categories.id),
    description: text('description'),
    officialUrl: text('official_url'),
    ratingSum: bigint('rating_sum', { mode: 'number' }).notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    // 先頭/末尾/連続ハイフン禁止 (URL 正準化、SEO 安全、Phase 2-a/2-b 継承)。
    check('events_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // Layer2: DB CHECK。空白のみの表示名を Unicode-aware で拒否 (Backlog A/B 教訓、判断 #4)。
    // ASCII 空白 + 全角スペース (U+3000) + タブ/改行 を charset で明示。
    check('events_name_not_blank', sql`btrim(${table.name}, E' \t\n\r　') <> ''`),
    // Layer2: DB CHECK。official_url は NULL or 非空白文字列 (Unicode-aware)。
    check(
      'events_official_url_not_blank',
      sql`${table.officialUrl} is null or btrim(${table.officialUrl}, E' \t\n\r　') <> ''`,
    ),
    // btree index on FK column primary_category_id: category landing pages
    // (`WHERE primary_category_id = ?`) hit sequential scan without this since
    // Postgres doesn't auto-index FK-referencing columns (only PK/UNIQUE get
    // implicit indexes). Added per PR #261 claude[bot] R2 finding, applied via
    // forward-fix migration 0010 (0009 is already on staging, no retroactive
    // edit per PR #250 SoP §9).
    index('events_primary_category_id_idx').on(table.primaryCategoryId),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;
