import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.profiles
 *
 * Crescendolls 会員機能のプロフィールテーブル。auth.users と 1:1 で対応する。
 *
 * 設計判断 (hashed-doodling-hopper.md §データモデル に準拠):
 * - `id` は **永続 ID**。auth とは別の ID 空間 (M1 で分離、下記)。
 * - `auth_user_id` が auth.users(id) を参照し、退会で **null になる** (ON DELETE SET NULL)。
 * - `username` は **初期 NULL** = onboarding 未完了の判定キー。onboarding 完了時に
 *   update で埋める。一意性は case-insensitive (`lower(username)` の unique index)。
 * - `display_name` は **nullable** (退会時に null 化して匿名化するため)。
 *   handle_new_user トリガーが `coalesce(raw_user_meta_data->>'full_name','')` で
 *   空文字埋めし、onboarding で必須上書きする点は変わらない。
 * - `avatar_url` は作らない (v2、YAGNI)。
 *
 * ★ M1 (認証 ID / 永続 ID の分離、migration 0011):
 *   旧構造は `profiles.id` が auth.users(id) を ON DELETE CASCADE で直接参照しており、
 *   **退会するとプロフィールごと消えた**。これでは「退会してもレビューは残す」
 *   (event-review-data-model.md §4.5) が成立しない。
 *
 *   | 列 | 意味 | 退会時 |
 *   |---|---|---|
 *   | `id` | 永続 ID。reviews / review_helpful の FK 先 | 変わらない |
 *   | `auth_user_id` | auth リンク | **null になる** |
 *   | `withdrawn_at` | 退会時刻 | now() が入る |
 *   | `display_name` | 表示名 | **null 化** (PII 匿名化) |
 *   | `username` | 公開ハンドル | **null 化** (再利用のため解放) |
 *
 *   RLS は `auth_user_id` 基準に書き換え済み (0011 ステップ 8)。`id` 基準のままだと
 *   reviews 系の書き込み policy が参照する副問い合わせが 0 行を返す。
 *
 *   なお `id` の既定値を `gen_random_uuid()` にするのは **M2 (0014、不可逆)**。
 *   M1 の間は登録トリガが `id = NEW.id` を入れ続けるため旧 FK を戻せる。
 *   手順と可逆性 + migration 番号の一次資料:
 *   `one-more-time/docs/schema/revolution-profiles-migration.md` §4
 *
 *   ⚠️ 番号の訂正 (2026-08-06): 本 docstring は M2 を `0013` と書いていたが、
 *   2026-08-04 の BOSS 確定で **`0013` = 新規 6 テーブル / `0014` = M2** の順に
 *   決まった (新規テーブルは M1 にしか依存しないため、M2 を遅らせるほど
 *   ロールバック窓が長く保てる)。同じ誤りが `drizzle/0011_*.sql` L21 にも
 *   残っているが、**0011 は staging / production 適用済みのため編集しない**
 *   (PR #250 SoP §9 / PR #258・#259 の drift 事案)。
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
 *
 * 注 (RLS): `ENABLE ROW LEVEL SECURITY` + ポリシーも同じ custom SQL migration (0001)
 *     で付与する (migrate が実行)。Drizzle snapshot の `isRLSEnabled:false` は、RLS を
 *     pgTable の `enableRls` でなく custom SQL で管理しているための想定どおりの表示で、
 *     実 DB では有効 (pg_class.relrowsecurity=true)。`migrate` 運用前提のため drift は無害。
 */
export const profiles = pgTable(
  'profiles',
  {
    // 永続 ID。M1 以降 auth とは別の ID 空間。reviews / review_helpful の FK 先。
    // 既定値 gen_random_uuid() が付くのは M2 (0014) から。
    id: uuid('id').primaryKey().notNull(),
    // auth.users(id) へのリンク。退会で null になる (ON DELETE SET NULL)。
    // FK 句と UNIQUE は custom SQL migration 側で付与する
    // (Drizzle は auth スキーマを管理しないため)。
    authUserId: uuid('auth_user_id'),
    // 初期 NULL = onboarding 未完了。onboarding 完了で埋める。退会で null に戻す。
    username: text('username'),
    // handle_new_user が coalesce で空文字埋め、onboarding で必須上書き。
    // 退会時に null 化して匿名化するため nullable。
    displayName: text('display_name'),
    // 退会時刻。null = 現役。表示層はこれを見て「退会済みユーザー」を出す。
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // auth.users.created_at から移送した実際の登録日時 (0011 ステップ 2b)。
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Layer2: DB CHECK。zod (Layer1) と同じ正規表現を二段防御として保持。
    // 退会時の username = null は CHECK を通過する (NULL は CHECK 対象外)。
    check('profiles_username_format', sql`${table.username} ~ '^[a-zA-Z0-9_]{3,24}$'`),
    // Layer3: case-insensitive 一意。表示は入力時の大小を保持しつつ重複は大小無視で弾く。
    // 退会で null になった行は NULL != NULL のため複数共存できる。
    uniqueIndex('profiles_username_lower_idx').on(sql`lower(${table.username})`),
  ],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileInsert = typeof profiles.$inferInsert;
