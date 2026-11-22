import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { test as setup } from '@playwright/test';

import { sessionCookiesFor } from '../../test-support/member-session';
import {
  createTestDataScope,
  createTestMember,
  deleteTestMember,
} from '../../test-support/test-data';
import { MEMBER_RECORD_PATH, MEMBER_STATE_PATH } from './paths';

/**
 * 会員を 1 人作り、ログインした状態を保存する。
 *
 * 会員は全テストの後に `member.teardown.ts` が消す。ここで作る会員は `member` プロジェクトの
 * テストが共有するので、テストはこの会員の状態 (いいね・口コミなど) を書き換えたまま残さないこと。
 * 書き換えるテストは、`createTestDataScope().createMember()` で自分専用の会員を作る。
 */
setup('会員としてログインした状態を保存する', async ({ baseURL }) => {
  const { admin } = createTestDataScope();

  // CI では setup もやり直される。前の試行の会員が残っていれば先に消す (teardown は最後の 1 人しか消さないため)。
  // 記録が古く、会員がもう消えている時の失敗は無視する
  const previous = await readPreviousMemberId();
  if (previous) await deleteTestMember(admin, previous).catch(() => undefined);

  const member = await createTestMember(admin);

  // teardown が必ず消せるように、cookie を作る前に記録する
  await mkdir(path.dirname(MEMBER_RECORD_PATH), { recursive: true });
  await writeFile(MEMBER_RECORD_PATH, JSON.stringify({ userId: member.userId }));

  // 開発サーバー (next dev) は、まだ組み立てていないページを複数の worker が同時に開くと、自分の
  // manifest を読みかけで 500 を返すことがある ("Unexpected end of JSON input")。並列の前に、開催と
  // 投稿のページを一度だけ組み立てておく (中身は 404 でよい。組み立てが済めばよい)
  for (const warmup of ['/collabo-cafe/1/warmup', '/collabo-cafe/1/warmup/review']) {
    await fetch(new URL(warmup, baseURL)).catch(() => undefined);
  }

  const cookies = await sessionCookiesFor(member);
  const { hostname } = new URL(baseURL!);

  await writeFile(
    MEMBER_STATE_PATH,
    JSON.stringify({
      cookies: cookies.map(({ name, value }) => ({
        name,
        value,
        domain: hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      })),
      origins: [],
    })
  );
});

async function readPreviousMemberId(): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(MEMBER_RECORD_PATH, 'utf8')) as { userId: string }).userId;
  } catch {
    return undefined;
  }
}
