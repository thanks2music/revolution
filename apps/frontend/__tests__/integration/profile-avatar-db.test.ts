/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  anonClient,
  createTestDataScope,
  createTestMember,
  signInAsMember,
  type TestDataScope,
  type TestMember,
} from '@/test-support/test-data';

/**
 * プロフィール画像の列 (migration 0031、one-more-time #171) の守りを、ローカルの実 DB で確かめる。
 * - 本人は画像の状態と理由を書けない (書くのはサーバーの service role だけ)
 * - 他人に見えるのは、公開の時だけ値が入る avatar_public_key だけ
 * - BOSS が外した会員は画像を持てない / 状態の組み合わせの CHECK
 * - 退会すると画像のキー・状態・理由が空になる
 */
describe('プロフィール画像の列', () => {
  let data: TestDataScope;

  beforeEach(() => {
    data = createTestDataScope();
  });
  afterEach(async () => {
    await data.cleanup();
  });

  async function profileIdOf(member: TestMember): Promise<string> {
    const { data: row, error } = await data.admin
      .from('profiles')
      .select('id')
      .eq('auth_user_id', member.userId)
      .single();
    if (error) throw error;
    return row.id as string;
  }

  async function setAvatar(profileId: string, values: Record<string, unknown>) {
    return data.admin.from('profiles').update(values).eq('id', profileId);
  }

  it('本人は画像のキー・状態・理由を書けない (表示名は書ける)', async () => {
    const member = await data.createMember();
    const client = await signInAsMember(member);

    for (const values of [
      { avatar_key: 'preview/profiles/x/y' },
      { avatar_status: 'published' },
      { avatar_reason_code: 'unverifiable' },
      { avatar_removed_at: null },
    ]) {
      const { error } = await client
        .from('profiles')
        .update(values)
        .eq('auth_user_id', member.userId);
      expect(error?.code).toBe('42501');
    }
    const { error } = await client
      .from('profiles')
      .update({ display_name: '新しい名前' })
      .eq('auth_user_id', member.userId);
    expect(error).toBeNull();
  });

  it('他人と未ログインに見えるのは、公開の時の avatar_public_key だけ', async () => {
    // 他人の profile は、公開の口コミがある時に見える (0018)
    const { author } = await data.createReview({ status: 'published' });
    const profileId = await profileIdOf(author);
    const viewer = await signInAsMember(await data.createMember());

    await setAvatar(profileId, { avatar_key: 'preview/profiles/a/1', avatar_status: 'pending' });
    const pending = await anonClient()
      .from('profiles')
      .select('avatar_public_key')
      .eq('id', profileId)
      .single();
    expect(pending.data).toEqual({ avatar_public_key: null });

    await setAvatar(profileId, { avatar_status: 'published' });
    for (const client of [anonClient(), viewer]) {
      const { data: row } = await client
        .from('profiles')
        .select('avatar_public_key')
        .eq('id', profileId)
        .single();
      expect(row).toEqual({ avatar_public_key: 'preview/profiles/a/1' });
    }
    for (const column of ['avatar_key', 'avatar_status', 'avatar_reason_code']) {
      const { error } = await anonClient().from('profiles').select(column).eq('id', profileId);
      expect(error?.code).toBe('42501');
      const { error: viewerError } = await viewer
        .from('profiles')
        .select(column)
        .eq('id', profileId);
      expect(viewerError?.code).toBe('42501');
    }
  });

  it('状態の組み合わせを CHECK が守る。外した会員は画像を持てない', async () => {
    const profileId = await profileIdOf(await data.createMember());

    // キーがあるのに状態が無い / 落ちたのに理由が無い / 審査中なのにキーが無い
    for (const values of [
      { avatar_key: 'preview/profiles/b/1' },
      { avatar_status: 'rejected' },
      { avatar_status: 'pending' },
      { avatar_status: 'published', avatar_key: 'k', avatar_reason_code: 'unverifiable' },
    ]) {
      const { error } = await setAvatar(profileId, values);
      expect(error?.code).toBe('23514');
    }

    expect(
      (
        await setAvatar(profileId, {
          avatar_status: 'rejected',
          avatar_reason_code: 'unverifiable',
        })
      ).error
    ).toBeNull();
    expect(
      (
        await setAvatar(profileId, {
          avatar_status: 'removed',
          avatar_reason_code: null,
          avatar_removed_at: new Date().toISOString(),
        })
      ).error
    ).toBeNull();
    const { error } = await setAvatar(profileId, {
      avatar_key: 'preview/profiles/b/2',
      avatar_status: 'pending',
    });
    expect(error?.code).toBe('23514');
  });

  it('退会すると画像のキー・状態・理由が空になる', async () => {
    // 退会のトリガの後の行を見るため、片付けの対象外で作り、最後に profiles の行を消す
    const member = await createTestMember(data.admin);
    const profileId = await profileIdOf(member);
    await setAvatar(profileId, { avatar_key: 'preview/profiles/c/1', avatar_status: 'published' });

    const { error: deleteError } = await data.admin.auth.admin.deleteUser(member.userId);
    expect(deleteError).toBeNull();

    const { data: row } = await data.admin
      .from('profiles')
      .select('avatar_key, avatar_status, avatar_reason_code, avatar_public_key, withdrawn_at')
      .eq('id', profileId)
      .single();
    expect(row).toMatchObject({
      avatar_key: null,
      avatar_status: null,
      avatar_reason_code: null,
      avatar_public_key: null,
    });
    expect(row?.withdrawn_at).not.toBeNull();
    await data.admin.from('profiles').delete().eq('id', profileId);
  });

  it('上げる URL の記録は、1 人 1 日に取り込んでいない物が 10 まで', async () => {
    const profileId = await profileIdOf(await data.createMember());
    for (let i = 0; i < 10; i += 1) {
      const { error } = await data.admin
        .from('profile_avatar_uploads')
        .insert({ image_id: crypto.randomUUID(), profile_id: profileId });
      expect(error).toBeNull();
    }
    const { error } = await data.admin
      .from('profile_avatar_uploads')
      .insert({ image_id: crypto.randomUUID(), profile_id: profileId });
    expect(error?.message).toContain('too many pending profile avatar uploads');
  });
});
