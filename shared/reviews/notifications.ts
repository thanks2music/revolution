import 'server-only';

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SlackMessage } from '@revolution/slack/post-message';
import { escapeAndTruncate } from '@revolution/slack/text';
import type { ReviewReportReason } from '@revolution/schemas/review-constants';

import { REPORT_REASON_LABELS } from './labels';
import { notifySlack, type SlackDestination, type SlackEnv } from './notify-slack';

/**
 * 会員の動作を Slack で BOSS に知らせる (S4 / one-more-time #169)。
 *
 * - 要対応 (`attention`、BOSS へのメンション): 新しい通報 / AI の審査で BOSS の確認待ちになった口コミ
 * - お知らせ (`notice`): 口コミの投稿・編集して出し直し・削除 / AI の審査の結果 (公開・差し戻し) /
 *   会員登録 / 記事へのいいね
 * - 載せるのは表示名・開催名・星・本文の冒頭・管理アプリへのリンクだけ。メールアドレス・写真・通報した人・
 *   理由のひとことは載せない (仕様 #156)
 * - 入口 (Server Action の `after()`) から 1 回ずつ送る。送信も文の組み立ても例外を外へ出さない
 *   (通知の失敗で会員の操作を失敗させない。失敗は Sentry に残す)。再送はしない
 *
 * 送らない物: 「参考になった」・下書きの保存・BOSS が管理アプリでした操作
 */

/** 通知の文に使う口コミの中身 (service role で読む。loadReviewSummary) */
export type ReviewSummary = {
  reviewId: number;
  /** 投稿者の表示名。退会済みなら null */
  authorName: string | null;
  eventName: string;
  venueName: string | null;
  rating: number | null;
  body: string | null;
};

export type ReviewNotification =
  | { type: 'review_submitted' | 'review_edited' | 'review_deleted'; review: ReviewSummary }
  | {
      type: 'review_screened';
      review: ReviewSummary;
      status: 'published' | 'rejected' | 'needs_review';
      /** BOSS の確認待ちになった理由が AI の審査の失敗か (迷ったのではなく) */
      aiFailure: boolean;
    }
  | { type: 'review_reported'; review: ReviewSummary; reasonCode: ReviewReportReason }
  | { type: 'member_joined'; displayName: string }
  | { type: 'article_liked'; displayName: string | null; articleTitle: string };

/** 本文の冒頭の長さ (字) */
export const BODY_EXCERPT_CHARS = 80;
/** 表示名・開催名などの 1 項目の長さの上限 (字)。外から来た値なので切り詰める */
const NAME_MAX_CHARS = 100;

const DELETED_MEMBER = '退会済みユーザー';

/** 通知の文を作る (Layer 1)。宛先と、Slack に送る text / blocks を返す */
export function buildSlackMessage(
  notification: ReviewNotification,
  options: { adminUrl?: string | null } = {}
): { destination: SlackDestination; message: SlackMessage } {
  const adminUrl = options.adminUrl?.replace(/\/+$/, '') || null;
  const { destination, headline, lines, link } = describe(notification, adminUrl);
  const body = [`*${headline}*`, ...lines, link].filter(Boolean).join('\n');
  return {
    destination,
    message: {
      // 通知の代わりの文 (プッシュ通知などに出る)。見出しだけにする
      text: headline,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: body } }],
    },
  };
}

function describe(
  notification: ReviewNotification,
  adminUrl: string | null
): { destination: SlackDestination; headline: string; lines: string[]; link: string | null } {
  switch (notification.type) {
    case 'review_submitted':
      return reviewMessage('notice', '口コミが投稿されました', notification.review, adminUrl);
    case 'review_edited':
      return reviewMessage(
        'notice',
        '口コミが直して出し直されました',
        notification.review,
        adminUrl
      );
    case 'review_deleted':
      // 消した口コミは管理アプリで開けないので、リンクを付けない
      return { ...reviewMessage('notice', '口コミが削除されました', notification.review, null) };
    case 'review_screened':
      if (notification.status === 'published') {
        return reviewMessage('notice', 'AI が口コミを公開しました', notification.review, adminUrl);
      }
      if (notification.status === 'rejected') {
        return reviewMessage(
          'notice',
          'AI が口コミを差し戻しました',
          notification.review,
          adminUrl
        );
      }
      return reviewMessage(
        'attention',
        notification.aiFailure
          ? 'AI の審査に失敗した口コミがあります (確認待ち)'
          : 'AI が判断に迷った口コミがあります (確認待ち)',
        notification.review,
        adminUrl
      );
    case 'review_reported':
      return reviewMessage(
        'attention',
        `口コミが通報されました (${REPORT_REASON_LABELS[notification.reasonCode]})`,
        notification.review,
        adminUrl,
        'reports'
      );
    case 'member_joined':
      return {
        destination: 'notice',
        headline: '会員が登録しました',
        lines: [text(notification.displayName)],
        link: null,
      };
    case 'article_liked':
      return {
        destination: 'notice',
        headline: '記事にいいねが付きました',
        lines: [
          `${text(notification.articleTitle)} ・ ${text(notification.displayName ?? DELETED_MEMBER)}`,
        ],
        link: null,
      };
  }
}

function reviewMessage(
  destination: SlackDestination,
  headline: string,
  review: ReviewSummary,
  adminUrl: string | null,
  adminPage: 'reviews' | 'reports' = 'reviews'
) {
  const place = [review.eventName, review.venueName].filter(Boolean).join(' ');
  const meta = [
    text(review.authorName ?? DELETED_MEMBER),
    text(place),
    review.rating ? `星 ${review.rating}` : null,
  ].filter(Boolean);
  const excerpt = review.body?.replace(/\s+/g, ' ').trim();
  return {
    destination,
    headline,
    lines: [
      meta.join(' ・ '),
      excerpt ? `> ${escapeAndTruncate(excerpt, BODY_EXCERPT_CHARS)}` : null,
    ].filter((line): line is string => Boolean(line)),
    link: adminUrl ? `<${adminUrl}/${adminPage}/${review.reviewId}|管理アプリで開く>` : null,
  };
}

/** 外から来た 1 項目 (表示名・開催名・記事のタイトル)。切り詰めてからエスケープする */
function text(value: string): string {
  return escapeAndTruncate(value.replace(/\s+/g, ' ').trim(), NAME_MAX_CHARS);
}

/**
 * 通知の文に使う口コミの中身を読む (service role)。消した口コミも読める (削除の知らせのため)。
 * 見つからなければ null
 */
export async function loadReviewSummary(
  db: SupabaseClient,
  reviewId: number
): Promise<ReviewSummary | null> {
  const { data, error } = await db
    .from('reviews')
    .select(
      'id, rating, body, profiles!user_id(display_name, username, withdrawn_at), occurrences(venue_label, venues(name), events(name))'
    )
    .eq('id', reviewId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as {
    id: number;
    rating: number | null;
    body: string | null;
    profiles: {
      display_name: string | null;
      username: string | null;
      withdrawn_at: string | null;
    } | null;
    occurrences: {
      venue_label: string | null;
      venues: { name: string } | null;
      events: { name: string } | null;
    } | null;
  };
  return {
    reviewId: row.id,
    // 退会した会員は名前を出さない (公開サイトの口コミの一覧と同じ扱い)
    authorName: row.profiles?.withdrawn_at
      ? null
      : (row.profiles?.display_name ?? row.profiles?.username ?? null),
    eventName: row.occurrences?.events?.name ?? '',
    venueName: row.occurrences?.venues?.name ?? row.occurrences?.venue_label ?? null,
    rating: row.rating,
    body: row.body,
  };
}

/** 通知を送る口。送信の手段 (Slack / テストの偽物) を差し替えられる */
export type ReviewNotifier = {
  /** 送る。例外を外へ出さない */
  notify(notification: ReviewNotification): Promise<void>;
};

/** Slack に送る実体。env が無ければ何も送らない (notifySlack の決まり) */
export function createSlackNotifier(
  options: { adminUrl?: string | null; env?: SlackEnv } = {}
): ReviewNotifier {
  return {
    async notify(notification) {
      try {
        const { destination, message } = buildSlackMessage(notification, options);
        await notifySlack(destination, message, options.env);
      } catch (error) {
        reportNotifyError(error, notification.type);
      }
    },
  };
}

/**
 * 口コミについて知らせる。中身を読んでから通知を作る。読めなかった・送れなかった時も例外を外へ出さない
 * (入口の `after()` から呼ぶ)
 */
export async function notifyAboutReview(
  deps: { notifier: ReviewNotifier; db: SupabaseClient },
  reviewId: number,
  build: (review: ReviewSummary) => ReviewNotification
): Promise<void> {
  try {
    const review = await loadReviewSummary(deps.db, reviewId);
    if (!review) return;
    await deps.notifier.notify(build(review));
  } catch (error) {
    reportNotifyError(error, 'review');
  }
}

function reportNotifyError(error: unknown, kind: string): void {
  try {
    Sentry.captureException(error, { tags: { part: 'slack-notification', kind } });
  } catch {
    // 記録の手段が無いので、ここでは何もしない
  }
}
