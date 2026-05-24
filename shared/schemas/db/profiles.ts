import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.profiles
 *
 * Crescendolls 会員機能のプロフィールテーブル。auth.users と 1:1 で対応する。
 *
 * 設計判断 (hashed-doodling-hopper.md §データモデル に準拠):
 * - `id` は auth.users(id) を参照する PK。退会 (auth.users 削除) で cascade 削除。
 * - `username` は **初期 NULL** = onboarding 未完了の判定キー。onboarding 完了時に
 *   update で埋める。一意性は case-insensitive (`lower(username)` の unique index)。
 * - `display_name` は NOT NULL。handle_new_user トリガーが
 *   `coalesce(raw_user_meta_data->>'full_name','')` で空文字埋めし、onboarding で必須上書き。
 * - `avatar_url` は作らない (v2、YAGNI)。
 *
 * username の三段防御:
 *   Layer1 = zod (shared/schemas/profile.ts、正規表現・長さの真実源)
 *   Layer2 = DB CHECK (`username ~ '^[a-zA-Z0-9_]{3,24}$'`、本ファイル)
 *   Layer3 = `lower(username)` の unique index (case-insensitive 一意、本ファイル)
 *
 * 注: auth スキーマの users テーブルは Supabase が管理しているため Drizzle 側では
 *     定義せず、FK は custom SQL migration (drizzle/0001_crescendolls_rls.sql) で
 *     `references auth.users(id)` として張る。本 pgTable は public.profiles の
 *     カラム・CHECK・unique index のみを定義する (drizzle-zod 派生の真実源)。
 */
export const profiles = pgTable(
  'profiles',
  {
    // auth.users(id) を参照する PK。FK 句は custom SQL migration 側で付与する
    // (Drizzle は auth スキーマを管理しないため)。
    id: uuid('id').primaryKey().notNull(),
    // 初期 NULL = onboarding 未完了。onboarding 完了で埋める。
    username: text('username'),
    // handle_new_user が coalesce で空文字埋め、onboarding で必須上書き。
    displayName: text('display_name').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    check('profiles_username_format', sql`${table.username} ~ '^[a-zA-Z0-9_]{3,24}$'`),
    // Layer3: case-insensitive 一意。表示は入力時の大小を保持しつつ重複は大小無視で弾く。
    uniqueIndex('profiles_username_lower_idx').on(sql`lower(${table.username})`),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileInsert = typeof profiles.$inferInsert;
