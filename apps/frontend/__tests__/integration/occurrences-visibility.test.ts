import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { anonClient, createTestDataScope, type TestDataScope } from '@/test-support/test-data';

/**
 * 開催の公開範囲 (RLS) をローカルの実 DB で確かめる。
 *
 * 口コミの結合テストの土台 (omt #159) の最初の 1 本。書き込みはしない利用者 (anon) から見て、
 * 承認前の開催は存在しないのと同じになり、承認済みの開催だけが見える。
 */
describe('開催の公開範囲', () => {
  let data: TestDataScope | undefined;

  beforeEach(() => {
    data = createTestDataScope();
  });

  afterEach(async () => {
    // beforeEach で接続に失敗した時は data が無い (その時の本当の原因は beforeEach のエラー)
    await data?.cleanup();
  });

  it('anon は承認前の開催を読めない', async () => {
    const event = await data!.createEvent();
    const unverified = await data!.createOccurrence({ eventId: event.id, verified: false });

    const { data: rows, error } = await anonClient()
      .from('occurrences')
      .select('id')
      .eq('id', unverified.id);

    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });

  it('anon は承認済みの開催を読める', async () => {
    const event = await data!.createEvent();
    const verified = await data!.createOccurrence({ eventId: event.id, verified: true });

    const { data: rows, error } = await anonClient()
      .from('occurrences')
      .select('id')
      .eq('id', verified.id);

    expect(error).toBeNull();
    expect(rows).toEqual([{ id: verified.id }]);
  });
});
