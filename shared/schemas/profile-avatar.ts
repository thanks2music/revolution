import { z } from 'zod';

/**
 * プロフィール画像 (one-more-time #171) の定数と型。DB の CHECK (shared/schemas/db/profiles.ts) と同じ値
 *
 * - 審査中 (`pending`) と公開 (`published`) の時だけキーがある。落ちた (`rejected`) 時は理由がある
 * - 外した (`removed`) は、BOSS が通報を受けて外した状態。`avatar_removed_at` が入り、以後は設定できない
 */
export const AVATAR_STATUSES = ['pending', 'published', 'rejected', 'removed'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

/** 落ちた理由。AI の審査が 2 回やり直しても失敗した時は `unverifiable` (確認できなかった) */
export const AVATAR_REJECT_REASONS = ['sexual_or_violent', 'unverifiable'] as const;
export type AvatarRejectReason = (typeof AVATAR_REJECT_REASONS)[number];

export const AVATAR_REJECT_REASON_LABELS: Record<AvatarRejectReason, string> = {
  sexual_or_violent: '性的・暴力的な表現が含まれていました',
  unverifiable: '確認できませんでした',
};

/** 作る大きさ (正方形、px)。表示は 32〜56px なので、2x・4x まで */
export const AVATAR_WIDTHS = [64, 128, 256] as const;

/** 審査に渡す大きさ */
export const AVATAR_SCREENING_WIDTH = 256;

export const AvatarStatusSchema = z.enum(AVATAR_STATUSES);
export const AvatarRejectReasonSchema = z.enum(AVATAR_REJECT_REASONS);
