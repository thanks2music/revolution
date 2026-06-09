'use server';

/**
 * いいね Server Actions (Crescendolls 会員機能 / M3)
 *
 * - toggleFavorite(targetKey): 記事いいねのトグル。user_id は getUser() から取得し
 *   **クライアント入力にしない** (RLS と二重防御)。target_type は 'article' 固定。
 * - getFavorites(): 本人のいいね一覧 (マイページ用)。新しい順。
 *
 * 設計判断 (profile.ts / M2 の方針を踏襲):
 * - 読み書きは **Supabase server クライアント経由** (RLS 適用)。M1 の Drizzle client は
 *   DATABASE_URL = postgres ユーザー (RLS bypass) で接続するため、いいねの本人限定を
 *   担保するには RLS が効く PostgREST 経由が正しい (二重防御)。
 * - 複合 PK (user_id, target_type, target_key) のため、insert 競合は 23505。
 *   楽観 UI のレース等で重複 insert が来ても「既にいいね済み」として正常終了する。
 * - target_key は zod (FavoriteSchema 由来) で min(1) を検証 (空キー insert を防ぐ)。
 * - throw せず型付き結果 ({ ok, liked } | { ok:false, error }) を返す。UI が
 *   楽観更新のロールバック判断に使う。
 */

import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/auth/current-user';

const TARGET_TYPE = 'article' as const;
const PG_UNIQUE_VIOLATION = '23505';
/**
 * マイページのいいね一覧の取得上限。Closed Beta では十分大きく、未バインドな
 * 全件取得を避ける防御的キャップ。これを恒常的に超える規模になったら Server-side
 * pagination 化する (claude[bot] review、Backlog `6ghXHVMgfxR7J828` と整合)。
 */
const FAVORITES_FETCH_LIMIT = 200;

/** target_key は非空 (buildArticleKey が生成する URL path 連結キー)。 */
const TargetKeySchema = z.string().min(1, { message: 'いいね対象が不正です' });

export type ToggleFavoriteResult =
  | { ok: true; liked: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

export interface FavoriteItem {
  targetKey: string;
  createdAt: string;
}

export type GetFavoritesResult =
  | { ok: true; favorites: FavoriteItem[] }
  | { ok: false; error: string; needsAuth?: boolean };

export interface FavoriteState {
  isAuthed: boolean;
  liked: boolean;
}

/**
 * 指定 target_key について「認証済みか」「本人がいいね済みか」を返す。
 *
 * LikeButton がマウント後にクライアントから呼ぶ (記事ページの静的レンダリングを
 * 壊さないため、cookie 依存のいいね状態取得は記事本文の render から切り離す)。
 * 未認証や未いいねは安全側 (false) に倒し、記事閲覧 (200) を阻害しない。
 */
export async function getFavoriteState(targetKey: string): Promise<FavoriteState> {
  const parsed = TargetKeySchema.safeParse(targetKey);
  if (!parsed.success) return { isAuthed: false, liked: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) return { isAuthed: false, liked: false };

  const { data, error } = await supabase
    .from('favorites')
    .select('target_key')
    .eq('user_id', user.id)
    .eq('target_type', TARGET_TYPE)
    .eq('target_key', parsed.data)
    .maybeSingle();

  // 一時的な select エラーを握り潰して liked:false を返すと、認証済みユーザーに
  // 「未いいね」と誤表示し、再読込でいいねが消えたように見える。toggleFavorite と
  // 同様に error を検査し、エラー時は throw して LikeButton の .catch を発火させ、
  // 「いいね状態を取得できませんでした」を表示させる (自信を持って false に倒さない)。
  if (error) {
    throw new Error('Failed to load favorite state');
  }

  return { isAuthed: true, liked: !!data };
}

/**
 * 記事いいねをトグルする。既にいいね済みなら解除、未いいねなら追加。
 * 戻り値 `liked` はトグル後の状態 (true=いいね中 / false=解除済み)。
 */
export async function toggleFavorite(
  targetKey: string,
): Promise<ToggleFavoriteResult> {
  const parsed = TargetKeySchema.safeParse(targetKey);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '対象が不正です' };
  }
  const key = parsed.data;

  const supabase = await createClient();

  // user_id は getUser() から取得 (クライアント入力にしない = RLS と二重防御)。
  // per-request memoized なヘルパ経由 (同リクエスト内の重複 getUser を dedup)。
  const {
    data: { user },
    error: userError,
  } = await getCachedUser();

  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', needsAuth: true };
  }

  // 現在のいいね状態を確認 (RLS により本人行のみ select 可能)。
  const { data: existing, error: selectError } = await supabase
    .from('favorites')
    .select('target_key')
    .eq('user_id', user.id)
    .eq('target_type', TARGET_TYPE)
    .eq('target_key', key)
    .maybeSingle();

  if (selectError) {
    return { ok: false, error: 'いいねの状態を取得できませんでした' };
  }

  if (existing) {
    // 解除
    const { error: deleteError } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('target_type', TARGET_TYPE)
      .eq('target_key', key);

    if (deleteError) {
      return { ok: false, error: 'いいねの解除に失敗しました' };
    }
    return { ok: true, liked: false };
  }

  // 追加
  const { error: insertError } = await supabase.from('favorites').insert({
    user_id: user.id,
    target_type: TARGET_TYPE,
    target_key: key,
  });

  if (insertError) {
    // 楽観 UI のレース等で並行 insert が来た場合は複合 PK 違反 (23505)。
    // 既にいいね済みとして liked:true で正常終了する (冪等)。
    if (insertError.code === PG_UNIQUE_VIOLATION) {
      return { ok: true, liked: true };
    }
    return { ok: false, error: 'いいねの追加に失敗しました' };
  }

  return { ok: true, liked: true };
}

/**
 * 本人のいいね一覧を取得する (マイページ用)。新しい順。
 * RLS により他人の favorites は見えない。
 */
export async function getFavorites(): Promise<GetFavoritesResult> {
  const supabase = await createClient();

  // per-request memoized なヘルパ経由 (マイページの page.tsx も同じヘルパで getUser する
  // ため、1 リクエスト内の Auth サーバ往復は 1 回に dedup される / Vercel 監査)。
  const {
    data: { user },
    error: userError,
  } = await getCachedUser();

  if (userError || !user) {
    return { ok: false, error: 'ログインが必要です', needsAuth: true };
  }

  const { data, error } = await supabase
    .from('favorites')
    .select('target_key, created_at')
    .eq('user_id', user.id)
    .eq('target_type', TARGET_TYPE)
    .order('created_at', { ascending: false })
    .limit(FAVORITES_FETCH_LIMIT);

  if (error) {
    return { ok: false, error: 'いいね一覧を取得できませんでした' };
  }

  const favorites: FavoriteItem[] = (data ?? []).map((row) => ({
    targetKey: row.target_key as string,
    createdAt: row.created_at as string,
  }));

  return { ok: true, favorites };
}
