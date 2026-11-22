/* eslint-disable @typescript-eslint/no-explicit-any */
import { getHelpfulState, setHelpful } from '@/actions/review-helpful';
import { getCurrentMember } from '@/lib/auth/member';

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/auth/member', () => ({ getCurrentMember: jest.fn() }));
jest.mock('@/lib/supabase/server', () => {
  const builder: any = {};
  for (const name of ['select', 'eq', 'in', 'delete']) builder[name] = jest.fn(() => builder);
  builder.insert = jest.fn();
  builder.maybeSingle = jest.fn();
  return {
    __builder: builder,
    createClient: jest.fn(async () => ({ from: jest.fn(() => builder) })),
  };
});

const builder = (jest.requireMock('@/lib/supabase/server') as { __builder: any }).__builder;

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ['select', 'eq', 'in', 'delete']) builder[name].mockReturnValue(builder);
  (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
  builder.insert.mockResolvedValue({ error: null });
  builder.maybeSingle.mockResolvedValue({ data: { helpful_count: 3 }, error: null });
});

describe('setHelpful', () => {
  it('付けると、会員の profiles.id で入れ、新しい件数を返す', async () => {
    await expect(setHelpful(7, true)).resolves.toEqual({ ok: true, marked: true, count: 3 });
    expect(builder.insert).toHaveBeenCalledWith({ review_id: 7, user_id: 'profile-1' });
  });

  it('既に押してあっても成功にする (別のタブで押した時など)', async () => {
    builder.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    await expect(setHelpful(7, true)).resolves.toMatchObject({ ok: true, marked: true });
  });

  it('公開中でない口コミ (RLS の拒否) には、理由を返す', async () => {
    builder.insert.mockResolvedValue({ error: { code: '42501', message: 'rls' } });
    await expect(setHelpful(7, true)).resolves.toEqual({
      ok: false,
      error: '公開中の口コミにだけ押せます',
    });
  });

  it('外すと、本人の行だけを消す', async () => {
    builder.eq
      .mockReturnValueOnce(builder)
      .mockResolvedValueOnce({ error: null })
      .mockReturnValue(builder);
    await expect(setHelpful(7, false)).resolves.toMatchObject({ ok: true, marked: false });
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'profile-1');
  });

  it('未ログインはログインへ案内する', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(setHelpful(7, true)).resolves.toMatchObject({ ok: false, needsAuth: true });
    expect(builder.insert).not.toHaveBeenCalled();
  });
});

describe('getHelpfulState', () => {
  it('渡した口コミのうち、会員が押した物を返す', async () => {
    builder.in.mockResolvedValue({ data: [{ review_id: 2 }], error: null });
    await expect(getHelpfulState([1, 2])).resolves.toEqual({ isAuthed: true, marked: [2] });
    expect(builder.in).toHaveBeenCalledWith('review_id', [1, 2]);
  });

  it('会員でなければ isAuthed: false。不正な ID の一覧には問い合わせない', async () => {
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    await expect(getHelpfulState([1])).resolves.toEqual({ isAuthed: false, marked: [] });
    (getCurrentMember as jest.Mock).mockResolvedValue({ ok: true, profileId: 'profile-1' });
    await expect(getHelpfulState([-1])).resolves.toEqual({ isAuthed: true, marked: [] });
    expect(builder.in).not.toHaveBeenCalled();
  });
});
