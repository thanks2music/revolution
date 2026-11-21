import { readFile, rm } from 'node:fs/promises';

import { test as teardown } from '@playwright/test';

import { createTestDataScope, deleteTestMember } from '../../test-support/test-data';
import { MEMBER_RECORD_PATH, MEMBER_STATE_PATH } from './paths';

teardown('setup で作った会員を消す', async () => {
  let userId: string;
  try {
    ({ userId } = JSON.parse(await readFile(MEMBER_RECORD_PATH, 'utf8')) as { userId: string });
  } catch {
    // setup が会員を作る前に落ちた
    return;
  }

  const { admin } = createTestDataScope();
  try {
    await deleteTestMember(admin, userId);
  } catch (error) {
    // 会員も、退会のトリガが残す profile の行も、もう無いなら目的は果たせている
    // (前回の後片付けの途中で止まった時など)。どちらかが残っていれば失敗として知らせる
    const { data } = await admin.auth.admin.getUserById(userId);
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('id', userId);
    if (data.user || count) throw error;
  }
  await rm(MEMBER_RECORD_PATH, { force: true });
  await rm(MEMBER_STATE_PATH, { force: true });
});
