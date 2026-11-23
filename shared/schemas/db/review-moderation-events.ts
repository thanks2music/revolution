import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Schema-SDD 真実源 (DB レイヤ): public.review_moderation_events (0026、one-more-time #167)
 *
 * 口コミの審査の判断の記録。AI の審査の結果と、BOSS の操作 (公開・差し戻し・もう一度 AI にかける) ごとに
 * 1 行を足す。問い合わせやインシデントで「いつ・誰が・何をしたか」をたどるため (2026-11-23 BOSS 確定)。
 * - 足すのは DB の関数だけ (`apply_review_screening` と admin の関数)。行は書き換えない・消さない
 *   (トリガ `trg_review_moderation_events_append_only` が止める)
 * - 口コミの本文の写しは持たない (2026-11-23 BOSS 確定)。口コミが消えても記録は残すため、口コミへの外部キーは置かない
 * - 読めるのは admin だけ (関数 `admin_get_review` 経由)。RLS を有効にし、policy は置かない
 */
// 値の一覧は ../review.ts の REVIEW_MODERATION_ACTORS / REVIEW_MODERATION_ACTIONS と揃える
export const reviewModerationEvents = pgTable(
  'review_moderation_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    reviewId: bigint('review_id', { mode: 'number' }).notNull(),
    actor: text('actor').notNull(),
    /** admin の時の auth.users の ID。AI の時は null */
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reasonCode: text('reason_code'),
    reasonNote: text('reason_note'),
    aiModel: text('ai_model'),
    /** 写真ごとの非公開の印 ([{"id", "hide", "reason"}])。写真に触らなかった時は null */
    photoMarks: jsonb('photo_marks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('review_moderation_events_review_idx').on(table.reviewId, table.createdAt),
    check('review_moderation_events_actor_chk', sql`${table.actor} IN ('ai', 'admin')`),
    check(
      'review_moderation_events_action_chk',
      sql`${table.action} IN ('screened', 'published', 'rejected', 'requeued')`
    ),
    check(
      'review_moderation_events_admin_user_chk',
      sql`(${table.actor} = 'admin') = (${table.actorUserId} IS NOT NULL)`
    ),
  ]
).enableRLS();
