import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestDataScope, signInAsMember, type TestDataScope } from '@/test-support/test-data';

/**
 * 会員の profile の公開範囲 (RLS) をローカルの実 DB で確かめる。
 *
 * 会員としてログインしたクライアントで RLS が本人として評価されることも、ここで確かめる
 * (口コミの「本人にだけ見える」を確かめるテストは、この形の上に立つ)。
 */
describe('会員の profile の公開範囲', () => {
  let data: TestDataScope | undefined;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    await data?.cleanup();
  });

  it('会員は自分の profile を読める', async () => {
    const member = await data!.createMember();
    const client = await signInAsMember(member);

    const { data: rows, error } = await client
      .from('profiles')
      .select('username')
      .eq('auth_user_id', member.userId);

    expect(error).toBeNull();
    expect(rows).toEqual([{ username: member.username }]);
  });

  it('会員は他の会員の profile を読めない', async () => {
    const me = await data!.createMember();
    const other = await data!.createMember();
    const client = await signInAsMember(me);

    const { data: rows, error } = await client
      .from('profiles')
      .select('username')
      .eq('auth_user_id', other.userId);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });
});
