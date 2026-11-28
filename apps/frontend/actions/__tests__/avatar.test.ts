import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';

import { attachAvatar, removeAvatar, requestAvatarUpload } from '@/actions/avatar';
import { getCachedUser } from '@/lib/auth/current-user';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  attachAvatar as attachAvatarOperation,
  removeAvatar as removeAvatarOperation,
  requestAvatarUpload as requestAvatarUploadOperation,
  screenAvatar,
} from '@revolution/reviews/avatar/operations';
import { getReviewPhotoStorage } from '@revolution/reviews/photos/storage';

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/auth/current-user', () => ({ getCachedUser: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@revolution/reviews/avatar/operations', () => ({
  attachAvatar: jest.fn(),
  removeAvatar: jest.fn(),
  requestAvatarUpload: jest.fn(),
  screenAvatar: jest.fn(),
}));
jest.mock('@revolution/reviews/avatar/screener', () => ({
  getAvatarScreener: jest.fn(async () => ({ screen: jest.fn() })),
}));
jest.mock('@revolution/reviews/photos/storage', () => ({
  getReviewPhotoStorage: jest.fn(),
  reviewPhotoKeyPrefix: () => 'preview/',
}));

/** プロフィール画像の Server Actions (one-more-time #171) */

const profileRow = { data: { id: 'profile-1' }, error: null };
function adminWithProfile() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => profileRow;
  return { from: () => builder };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getCachedUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'user-1' } } });
  (createAdminClient as jest.Mock).mockReturnValue(adminWithProfile());
  (getReviewPhotoStorage as jest.Mock).mockReturnValue({});
});

describe('requestAvatarUpload', () => {
  it('形式と大きさが違えば、置き場所に触らずに断る', async () => {
    await expect(
      requestAvatarUpload({ contentType: 'image/gif', size: 10 })
    ).resolves.toMatchObject({ ok: false });
    expect(requestAvatarUploadOperation).not.toHaveBeenCalled();
  });

  it('ログインしていなければ needsAuth', async () => {
    (getCachedUser as jest.Mock).mockResolvedValue({ data: { user: null } });
    await expect(
      requestAvatarUpload({ contentType: 'image/jpeg', size: 10 })
    ).resolves.toMatchObject({ ok: false, needsAuth: true });
  });

  it('BOSS が外した会員は、設定できないと返す', async () => {
    (requestAvatarUploadOperation as jest.Mock).mockResolvedValue({ kind: 'removed' });
    await expect(requestAvatarUpload({ contentType: 'image/jpeg', size: 10 })).resolves.toEqual({
      ok: false,
      error: 'プロフィール画像は設定できません',
    });
  });
});

describe('attachAvatar', () => {
  it('取り込めたら、応答の後に審査を走らせる', async () => {
    (attachAvatarOperation as jest.Mock).mockResolvedValue({
      kind: 'ok',
      key: 'preview/profiles/p/i',
    });
    await expect(attachAvatar('i')).resolves.toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
    await ((after as jest.Mock).mock.calls[0][0] as () => Promise<void>)();
    expect(screenAvatar).toHaveBeenCalledWith(expect.anything(), {
      profileId: 'profile-1',
      key: 'preview/profiles/p/i',
    });
  });

  it('断った理由を利用者向けの文にする。想定外の失敗は Sentry に送る', async () => {
    (attachAvatarOperation as jest.Mock).mockResolvedValueOnce({
      kind: 'rejected',
      reason: 'unsupported',
    });
    await expect(attachAvatar('i')).resolves.toEqual({
      ok: false,
      error: 'JPEG・PNG・HEIC の画像を選んでください',
    });
    (attachAvatarOperation as jest.Mock).mockRejectedValueOnce(new Error('r2 down'));
    await expect(attachAvatar('i')).resolves.toMatchObject({ ok: false });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
  });
});

describe('removeAvatar', () => {
  it('外す。鍵の無い環境では今は設定できないと返す', async () => {
    (removeAvatarOperation as jest.Mock).mockResolvedValue({ kind: 'ok' });
    await expect(removeAvatar()).resolves.toEqual({ ok: true });
    (createAdminClient as jest.Mock).mockReturnValue(null);
    await expect(removeAvatar()).resolves.toMatchObject({ ok: false });
  });
});
