import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { todayInJst } from '../lib/occurrence/status';

import { getLocalSupabaseEnv } from './local-supabase';

/**
 * テストごとに独立したデータを作り、後片付けする口。
 *
 * ## なぜ `supabase db reset` を使わないか
 *
 * ローカルの Supabase は main checkout と worktree で共有している (`config.toml` の `project_id` が同じ)。
 * reset すると、手元で画面を確かめている別の作業のデータまで消える。そのため、テストが作った行だけを
 * 覚えておき、`cleanup()` で作った逆の順に消す。
 *
 * 作る行には `test-<ランダム>` で始まる slug やメールアドレスを付け、seed や他のテストと衝突させない。
 * テストが途中で落ちて後片付けが漏れても、この接頭辞で見分けられる。
 *
 * ## 使い方
 *
 * ```ts
 * let data: TestDataScope | undefined;
 * beforeEach(() => { data = createTestDataScope(); });
 * // 接続に失敗すると data が無いまま afterEach に来る。その時に原因のエラーを埋もれさせない
 * afterEach(() => data?.cleanup());
 * ```
 *
 * 書き込みは RLS を通らない service role のクライアントで行う (取り込みパイプラインや管理アプリと同じ立場)。
 * 確かめたい側 (anon・会員) のクライアントは `anonClient()` / `signInAsMember()` で別に作る。
 */
export type TestDataScope = {
  /** RLS を通らない管理用のクライアント。データの準備と後片付けにだけ使う */
  admin: SupabaseClient;
  /** categorySlug は企画の種別 (URL の第 1 階層) */
  createEvent(input?: {
    name?: string;
  }): Promise<{ id: number; slug: string; categorySlug: string }>;
  createOccurrence(input: {
    eventId: number;
    verified: boolean;
    /** null で日程未発表。省略すると今日 (JST) */
    startsOn?: string | null;
    endsOn?: string;
    cancelled?: boolean;
  }): Promise<{ id: number; slug: string }>;
  createMember(input?: TestMemberInput): Promise<TestMember>;
  /**
   * 開催中の開催 (10 日前〜20 日後) に、口コミを 1 件作る。投稿者を渡さなければ会員も作る。
   * 状態は既定で公開。口コミは後片付けで開催ごと消える
   */
  createReview(input?: {
    status?: 'published' | 'pending';
    author?: TestMember;
    body?: string;
    rating?: number;
  }): Promise<{
    reviewId: number;
    author: TestMember;
    event: { id: number; categorySlug: string };
    occurrence: { id: number; slug: string };
  }>;
  cleanup(): Promise<void>;
};

export type TestMemberInput = {
  username?: string;
  onboarded?: boolean;
  /** 管理アプリに入れる会員にする (app_metadata.role = 'admin'。one-more-time #167) */
  admin?: boolean;
};

export type TestMember = {
  userId: string;
  email: string;
  password: string;
  username: string;
};

/** テストが作るデータに付ける接頭辞。後片付けが漏れた行を見分けるのに使う */
export const TEST_DATA_PREFIX = 'test-';

export function createTestDataScope(): TestDataScope {
  const env = getLocalSupabaseEnv();
  const admin = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 後片付けは作った逆の順に行う (開催 → 企画のように、参照する側を先に消すため)
  const undo: Array<() => Promise<void>> = [];
  // 作った開催。後片付けの最初に、これらに付いた口コミ (会員のクライアントで作った物を含む) を消す
  const occurrenceIds: number[] = [];

  async function createEvent(input: { name?: string } = {}) {
    const slug = uniqueSlug('event');
    const category = await anyCategory(admin);
    const { data, error } = await admin
      .from('events')
      .insert({ slug, name: input.name ?? `テスト企画 ${slug}`, primary_category_id: category.id })
      .select('id, slug')
      .single();
    if (error) throw new Error(`企画を作れませんでした: ${error.message}`);

    undo.push(() => deleteById(admin, 'events', data.id));
    return { ...(data as { id: number; slug: string }), categorySlug: category.slug };
  }

  async function createOccurrence(input: {
    eventId: number;
    verified: boolean;
    startsOn?: string | null;
    endsOn?: string;
    cancelled?: boolean;
  }) {
    const slug = uniqueSlug('occ');
    const { data, error } = await admin
      .from('occurrences')
      .insert({
        event_id: input.eventId,
        slug,
        starts_on: input.startsOn === undefined ? jstDate() : input.startsOn,
        ends_on: input.endsOn ?? null,
        cancelled_at: input.cancelled ? new Date().toISOString() : null,
        verified: input.verified,
      })
      .select('id, slug')
      .single();
    if (error) throw new Error(`開催を作れませんでした: ${error.message}`);

    occurrenceIds.push(data.id);
    undo.push(() => deleteById(admin, 'occurrences', data.id));
    return data as { id: number; slug: string };
  }

  async function createMember(input: TestMemberInput = {}) {
    const member = await createTestMember(admin, input);
    undo.push(() => deleteTestMember(admin, member.userId));
    return member;
  }

  async function createReview(
    input: {
      status?: 'published' | 'pending';
      author?: TestMember;
      body?: string;
      rating?: number;
    } = {},
  ) {
    const event = await createEvent();
    const occurrence = await createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const author = input.author ?? (await createMember());
    const { data, error } = await admin
      .from('reviews')
      .insert({
        occurrence_id: occurrence.id,
        user_id: author.userId,
        status: input.status ?? 'published',
        rating: input.rating ?? 4,
        body: input.body ?? '楽しかった',
        visited_on: jstDate(-1),
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`口コミを作れませんでした: ${error.message}`);
    return { reviewId: data.id as number, author, event, occurrence };
  }

  async function cleanup() {
    const errors: unknown[] = [];
    // 口コミは開催と会員の profile を restrict で参照するので、どちらよりも先に消す
    if (occurrenceIds.length > 0) {
      const { error } = await admin.from('reviews').delete().in('occurrence_id', occurrenceIds);
      if (error) errors.push(new Error(`口コミを消せませんでした: ${error.message}`));
    }
    while (undo.length > 0) {
      const step = undo.pop()!;
      try {
        await step();
      } catch (error) {
        // 1 件が消せなくても残りは消す。最後にまとめて知らせる
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `テストデータの後片付けで ${errors.length} 件失敗しました`);
    }
  }

  return { admin, createEvent, createOccurrence, createMember, createReview, cleanup };
}

/** ログインしていない利用者 (anon) として読むクライアント */
export function anonClient(): SupabaseClient {
  const env = getLocalSupabaseEnv();
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 会員としてログインしたクライアント。RLS が本人として評価される */
export async function signInAsMember(member: TestMember): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  if (error) throw new Error(`会員としてログインできませんでした: ${error.message}`);
  return client;
}

/**
 * 会員を作る。オンボーディングを済ませた状態 (username と JWT の `onboarded`) を既定にする。
 *
 * `createTestDataScope().createMember()` を通さずに直接使うのは、Playwright の setup のように
 * テストの外で会員を作り、別の場所 (teardown) で消す時だけ。
 */
export async function createTestMember(
  admin: SupabaseClient,
  input: TestMemberInput = {},
): Promise<TestMember> {
  const suffix = randomSuffix();
  const email = `${TEST_DATA_PREFIX}${suffix}@example.com`;
  const password = `pw-${randomUUID()}`;
  // profiles_username_format: ^[a-zA-Z0-9_]{3,24}$
  const username = input.username ?? `test_${suffix}`;
  const onboarded = input.onboarded ?? true;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { onboarded },
    ...(input.admin ? { app_metadata: { role: 'admin' } } : {}),
  });
  if (error || !data.user) throw new Error(`会員を作れませんでした: ${error?.message}`);
  const userId = data.user.id;

  if (onboarded) {
    // profiles の行は auth.users の INSERT のトリガ (handle_new_user) が username なしで作る
    // 0 行の更新はエラーにならないので、行が返ることまで確かめる (トリガが profile を作らなかった時に気づくため)
    const { error: profileError } = await admin
      .from('profiles')
      .update({ username, display_name: username })
      .eq('auth_user_id', userId)
      .select('id')
      .single();
    if (profileError) {
      try {
        await deleteTestMember(admin, userId);
      } catch {
        // 後片付けの失敗より、profile を設定できなかった原因のほうを知らせる
      }
      throw new Error(`会員の profile を設定できませんでした: ${profileError.message}`);
    }
  }

  return { userId, email, password, username };
}

/**
 * 会員を消す。退会のトリガ (handle_user_deleted) が profiles を匿名化して残すので、その行も消す。
 */
export async function deleteTestMember(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`会員を消せませんでした (${userId}): ${error.message}`);
  // 退会後の profiles は auth_user_id が NULL になり、id は元の auth の id のまま残る
  await deleteById(admin, 'profiles', userId);
}

async function deleteById(admin: SupabaseClient, table: string, id: number | string) {
  const { error } = await admin.from(table).delete().eq('id', id);
  if (error) throw new Error(`${table} の ${id} を消せませんでした: ${error.message}`);
}

async function anyCategory(admin: SupabaseClient): Promise<{ id: number; slug: string }> {
  // 毎回同じカテゴリを使う (順序を決めないと、実行ごとに選ばれるカテゴリが変わりうる)
  const { data, error } = await admin
    .from('categories')
    .select('id, slug')
    .order('id')
    .limit(1)
    .single();
  if (error)
    throw new Error(`カテゴリが 1 件もありません (migration を確かめる): ${error.message}`);
  return data as { id: number; slug: string };
}

function uniqueSlug(kind: string): string {
  // slug の形式: ^[a-z0-9]+(-[a-z0-9]+)*$
  return `${TEST_DATA_PREFIX}${kind}-${randomSuffix()}`;
}

function randomSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

/**
 * 今日から offsetDays 日ずらした日付 (JST、YYYY-MM-DD)。開催や訪問日の相対の日付を作るのに使う。
 * JST の今日の決め方はアプリと同じ関数 (`lib/occurrence/status.ts` の todayInJst) に任せる
 */
export function jstDate(offsetDays = 0): string {
  return todayInJst(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}
