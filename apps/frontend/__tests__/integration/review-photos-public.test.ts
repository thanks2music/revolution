import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { getOccurrenceReviews } from '@/lib/reviews/queries';
import {
  anonClient,
  createTestDataScope,
  signInAsMember,
  jstDate,
  type TestDataScope,
} from '@/test-support/test-data';

// 公開のクライアントは lib/env.ts から接続先を読む。ローカルの Supabase に向ける
// (CI には .env.local が無く、手元でも本物の環境を読まないように)
jest.mock('@/lib/env', () => {
  const local = jest
    .requireActual<typeof import('@/test-support/local-supabase')>('@/test-support/local-supabase')
    .getLocalSupabaseEnv();
  return {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: local.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      SUPABASE_SECRET_KEY: local.secretKey,
      REVIEW_PUBLIC_MEDIA_BASE_URL: 'https://img.example.test/',
    },
  };
});

/**
 * #3 の口コミの写真とギャラリー (one-more-time #164)。公開で見える写真は、公開中で論理削除していない
 * 口コミの非公開でない写真だけ (migration 0024)。ギャラリーはさらにネタバレの口コミの写真を除く。
 */
describe('口コミの写真の公開の読み出し', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data.cleanup();
  });

  async function occurrence() {
    const event = await data.createEvent();
    return data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
  }

  /** 口コミを 1 件作り、写真を付けてから状態を決める (hidden は非公開にする写真の番号、1 始まり) */
  async function reviewWithPhotos(
    occurrenceId: number,
    input: {
      status?: 'published' | 'pending';
      hasSpoiler?: boolean;
      deleted?: boolean;
      photos: number;
      hidden?: number[];
      member?: Awaited<ReturnType<TestDataScope['createMember']>>;
    }
  ) {
    const member = input.member ?? (await data.createMember());
    const { data: review, error } = await data.admin
      .from('reviews')
      .insert({
        occurrence_id: occurrenceId,
        user_id: member.userId,
        status: 'pending',
        rating: 4,
        body: '楽しかった',
        visited_on: jstDate(-1),
        has_spoiler: input.hasSpoiler ?? false,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    const reviewId = review.id as number;
    const ids: number[] = [];
    for (let n = 1; n <= input.photos; n++) {
      const hidden = input.hidden?.includes(n);
      const { data: photo, error: photoError } = await data.admin
        .from('review_images')
        .insert({
          review_id: reviewId,
          object_key: `preview/reviews/${reviewId}/photo-${n}-${crypto.randomUUID()}`,
          width: 800,
          height: 600,
          variant_widths: [320, 720],
          hidden_at: hidden ? new Date().toISOString() : null,
          hidden_reason_code: hidden ? 'personal_info' : null,
        })
        .select('id')
        .single();
      if (photoError) throw photoError;
      ids.push(photo.id as number);
    }
    // 写真を足すと審査中に戻る (トリガ) ので、状態は写真の後に書く
    const { error: statusError } = await data.admin
      .from('reviews')
      .update({
        status: input.status ?? 'published',
        deleted_at: input.deleted ? new Date().toISOString() : null,
      })
      .eq('id', reviewId);
    if (statusError) throw statusError;
    return { reviewId, photoIds: ids };
  }

  it('anon には、公開中で論理削除していない口コミの、非公開でない写真だけが見える', async () => {
    const occ = await occurrence();
    const shown = await reviewWithPhotos(occ.id, { photos: 2, hidden: [2] });
    const spoiler = await reviewWithPhotos(occ.id, { photos: 1, hasSpoiler: true });
    const pending = await reviewWithPhotos(occ.id, { status: 'pending', photos: 1 });
    const deleted = await reviewWithPhotos(occ.id, { photos: 1, deleted: true });

    const { data: rows, error } = await anonClient()
      .from('review_images')
      .select('id')
      .in('review_id', [shown.reviewId, spoiler.reviewId, pending.reviewId, deleted.reviewId]);
    expect(error).toBeNull();
    expect((rows ?? []).map(row => row.id).sort((a, b) => a - b)).toEqual(
      [shown.photoIds[0], spoiler.photoIds[0]].sort((a, b) => a - b)
    );
  });

  it('会員には、他人の写真は anon と同じだけ見え、自分の写真は非公開の物も見える', async () => {
    const occ = await occurrence();
    const others = await reviewWithPhotos(occ.id, { photos: 2, hidden: [2] });
    const pendingOthers = await reviewWithPhotos(occ.id, { status: 'pending', photos: 1 });
    const viewer = await data.createMember();
    const own = await reviewWithPhotos(occ.id, { photos: 2, hidden: [1], member: viewer });

    const client = await signInAsMember(viewer);
    const { data: rows, error } = await client
      .from('review_images')
      .select('id')
      .in('review_id', [others.reviewId, pendingOthers.reviewId, own.reviewId]);
    expect(error).toBeNull();
    expect((rows ?? []).map(row => row.id).sort((a, b) => a - b)).toEqual(
      [others.photoIds[0], ...own.photoIds].sort((a, b) => a - b)
    );
  });

  it('anon は非公開の印と理由の列を読めない', async () => {
    const occ = await occurrence();
    await reviewWithPhotos(occ.id, { photos: 1 });
    const { error } = await anonClient().from('review_images').select('id, hidden_reason_code');
    expect(error?.code).toBe('42501');
  });

  it('#3 の口コミに写真が出て、ギャラリーにはネタバレと非公開の写真が出ない', async () => {
    const occ = await occurrence();
    const shown = await reviewWithPhotos(occ.id, { photos: 3, hidden: [2] });
    const spoiler = await reviewWithPhotos(occ.id, { photos: 2, hasSpoiler: true });

    const reviews = await getOccurrenceReviews(occ.id);

    const byId = new Map(reviews.latest.map(review => [review.id, review]));
    expect(byId.get(shown.reviewId)?.photos.map(photo => photo.id)).toEqual([
      shown.photoIds[0],
      shown.photoIds[2],
    ]);
    // ネタバレの口コミの写真はカードには出る (画面でたたむ)
    expect(byId.get(spoiler.reviewId)?.photos).toHaveLength(2);
    expect(byId.get(shown.reviewId)?.photos[0].src).toMatch(
      /^https:\/\/img\.example\.test\/preview\/reviews\/\d+\/photo-1-.+\/720\.webp$/
    );

    expect(reviews.gallery.total).toBe(2);
    expect(reviews.gallery.photos.map(photo => photo.id).sort((a, b) => a - b)).toEqual(
      [shown.photoIds[0], shown.photoIds[2]].sort((a, b) => a - b)
    );
  });

  it('ギャラリーは並べる枚数までで、総数は別に返す', async () => {
    const occ = await occurrence();
    await reviewWithPhotos(occ.id, { photos: 6 });

    const { gallery } = await getOccurrenceReviews(occ.id);
    expect(gallery.photos).toHaveLength(4);
    expect(gallery.total).toBe(6);
  });
});
