'use server';

/**
 * 口コミの「参考になった」(S4 / one-more-time #165)。
 *
 * - 押せるのは会員だけ。公開中の口コミにだけ付けられる (RLS の policy、migration 0020)。取り消せる
 * - 件数 (`reviews.helpful_count`) は DB のトリガが増減する
 * - 開催のページは ISR のまま描き、押したかどうかはマウント後に島が取る (いいねのボタンと同じ)
 * - 押すたびにページを作り直さない (押す回数が多い。件数は画面で先に変え、ページは 2 分ごとに作り直る)
 *
 * throw せず型付きの結果を返す。未ログイン・公開中でない口コミは利用者の操作なので Sentry に送らない。
 */

import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { getCurrentMember } from '@/lib/auth/member';
import { createClient } from '@/lib/supabase/server';

const PG_UNIQUE_VIOLATION = '23505';
/** RLS の WITH CHECK に当たった (公開中でない口コミ) */
const PG_RLS_VIOLATION = '42501';

/** 一度に状態を尋ねてよい口コミの数 (開催のページは新着と参考になった順の 2 つの一覧で最大 20 件) */
const MAX_STATE_IDS = 50;

export type HelpfulState = { isAuthed: boolean; marked: number[] };

/** 会員が「参考になった」を押した口コミ (渡した中から)。会員でなければ isAuthed: false */
export async function getHelpfulState(reviewIds: number[]): Promise<HelpfulState> {
  try {
    const ids = z.array(z.number().int().positive()).max(MAX_STATE_IDS).safeParse(reviewIds);
    const member = await getCurrentMember();
    if (!member.ok) return { isAuthed: false, marked: [] };
    if (!ids.success || ids.data.length === 0) return { isAuthed: true, marked: [] };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('review_helpful')
      .select('review_id')
      .eq('user_id', member.profileId)
      .in('review_id', ids.data);
    if (error) throw error;
    return { isAuthed: true, marked: (data ?? []).map(row => row.review_id as number) };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'getHelpfulState' } });
    return { isAuthed: false, marked: [] };
  }
}

export type SetHelpfulResult =
  { ok: true; marked: boolean; count: number } | { ok: false; error: string; needsAuth?: boolean };

/** 「参考になった」を付ける (marked: true) か外す (false)。押し直しても同じ結果になる */
export async function setHelpful(reviewId: number, marked: boolean): Promise<SetHelpfulResult> {
  try {
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return { ok: false, error: '口コミが見つかりません' };
    }
    const member = await getCurrentMember();
    if (!member.ok) return { ok: false, error: 'ログインしてください', needsAuth: true };

    const supabase = await createClient();
    if (marked) {
      const { error } = await supabase
        .from('review_helpful')
        .insert({ review_id: reviewId, user_id: member.profileId });
      // 既に押してあれば、そのまま (別のタブで押した時など)
      if (error && error.code !== PG_UNIQUE_VIOLATION) {
        if (error.code === PG_RLS_VIOLATION) {
          return { ok: false, error: '公開中の口コミにだけ押せます' };
        }
        throw error;
      }
    } else {
      const { error } = await supabase
        .from('review_helpful')
        .delete()
        .eq('review_id', reviewId)
        .eq('user_id', member.profileId);
      if (error) throw error;
    }

    const { data, error } = await supabase
      .from('reviews')
      .select('helpful_count')
      .eq('id', reviewId)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, marked, count: Number(data?.helpful_count ?? 0) };
  } catch (error) {
    Sentry.captureException(error, { tags: { action: 'setHelpful' } });
    return { ok: false, error: '保存できませんでした。時間をおいてもう一度お試しください' };
  }
}
