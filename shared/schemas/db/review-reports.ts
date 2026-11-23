import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { profiles } from './profiles';
import { reviews } from './reviews';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.review_reports (0028、one-more-time #168)
 *
 * 口コミとプロフィール画像への通報。閲覧者 (未ログインを含む) が理由を選んで送り、BOSS が管理アプリで処理する。
 * - 書き込みは公開サイトのサーバーが service role で呼ぶ関数 `submit_review_report` だけ。anon / authenticated には
 *   表も関数も渡さない (仕様 #156)。読み書きは関数だけなので、RLS を有効にし policy は置かない
 * - 同じ人 (会員は profiles.id、未ログインは端末の cookie の乱数) から同じ対象への未処理の通報は 1 件 (部分 unique)。
 *   IP アドレスなど、通報した人を特定する情報は持たない
 * - プロフィール画像の通報は表だけ備える。画面と処理は #171
 *
 * 値の一覧は ../review-constants.ts の REPORT_TARGET_TYPES / REVIEW_REPORT_REASONS /
 * PROFILE_IMAGE_REPORT_REASONS / REPORT_ACTIONS と揃える
 */
export const reviewReports = pgTable(
  'review_reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    targetType: text('target_type').notNull(),
    reviewId: bigint('review_id', { mode: 'number' }).references(() => reviews.id, {
      onDelete: 'cascade',
    }),
    targetProfileId: uuid('target_profile_id').references(() => profiles.id, {
      onDelete: 'cascade',
    }),
    reasonCode: text('reason_code').notNull(),
    /** 通報した会員。未ログインの通報と、退会した会員の通報は null */
    reporterProfileId: uuid('reporter_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    /** 未ログインの通報の端末 (cookie の乱数) */
    reporterDeviceId: uuid('reporter_device_id'),
    status: text('status').notNull().default('open'),
    /** 処理の内容 (1 回の処理で複数が重なることがある)。未処理の間は null */
    actions: text('actions').array(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    /** 処理した BOSS の auth.users の ID */
    handledBy: uuid('handled_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('review_reports_open_review_member_uniq')
      .on(table.reviewId, table.reporterProfileId)
      .where(
        sql`${table.status} = 'open' AND ${table.targetType} = 'review' AND ${table.reporterProfileId} IS NOT NULL`
      ),
    uniqueIndex('review_reports_open_review_device_uniq')
      .on(table.reviewId, table.reporterDeviceId)
      .where(
        sql`${table.status} = 'open' AND ${table.targetType} = 'review' AND ${table.reporterDeviceId} IS NOT NULL`
      ),
    uniqueIndex('review_reports_open_image_member_uniq')
      .on(table.targetProfileId, table.reporterProfileId)
      .where(
        sql`${table.status} = 'open' AND ${table.targetType} = 'profile_image' AND ${table.reporterProfileId} IS NOT NULL`
      ),
    uniqueIndex('review_reports_open_image_device_uniq')
      .on(table.targetProfileId, table.reporterDeviceId)
      .where(
        sql`${table.status} = 'open' AND ${table.targetType} = 'profile_image' AND ${table.reporterDeviceId} IS NOT NULL`
      ),
    index('review_reports_review_idx').on(table.reviewId),
    index('review_reports_reporter_profile_idx').on(table.reporterProfileId),
    index('review_reports_target_profile_idx').on(table.targetProfileId),
    check(
      'review_reports_target_type_chk',
      sql`${table.targetType} IN ('review', 'profile_image')`
    ),
    check(
      'review_reports_target_chk',
      sql`(${table.targetType} = 'review' AND ${table.reviewId} IS NOT NULL AND ${table.targetProfileId} IS NULL) OR (${table.targetType} = 'profile_image' AND ${table.targetProfileId} IS NOT NULL AND ${table.reviewId} IS NULL)`
    ),
    check(
      'review_reports_reason_code_chk',
      sql`(${table.targetType} = 'review' AND ${table.reasonCode} IN ('personal_info', 'abuse', 'spam', 'resale', 'spoiler_unmarked', 'photo_reposted', 'not_attended', 'other')) OR (${table.targetType} = 'profile_image' AND ${table.reasonCode} IN ('personal_info', 'abuse', 'spam', 'photo_reposted', 'other'))`
    ),
    check(
      'review_reports_reporter_chk',
      sql`${table.reporterProfileId} IS NULL OR ${table.reporterDeviceId} IS NULL`
    ),
    check('review_reports_status_chk', sql`${table.status} IN ('open', 'handled')`),
    check(
      'review_reports_actions_chk',
      sql`${table.actions} IS NULL OR (cardinality(${table.actions}) > 0 AND ${table.actions} <@ ARRAY['hidden', 'spoiler_marked', 'photo_hidden', 'image_removed', 'dismissed']::text[])`
    ),
    check(
      'review_reports_handled_chk',
      sql`(${table.status} = 'open' AND ${table.actions} IS NULL AND ${table.handledAt} IS NULL AND ${table.handledBy} IS NULL) OR (${table.status} = 'handled' AND ${table.actions} IS NOT NULL AND ${table.handledAt} IS NOT NULL AND ${table.handledBy} IS NOT NULL)`
    ),
  ]
).enableRLS();
