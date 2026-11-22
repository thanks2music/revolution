import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test as setup } from '@playwright/test';

import { getOccurrenceUrl } from '../../lib/event/event-url';
import { sessionCookiesFor } from '../../test-support/member-session';
import {
  createTestDataScope,
  createTestMember,
  deleteTestMember,
  jstDate,
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

/**
 * 開発サーバー (next dev) は、まだ組み立てていないページを複数の worker が同時に開くと、自分の manifest を
 * 読みかけで 500 を返すことがある ("Unexpected end of JSON input")。並列のテストの前に、口コミのある開催の
 * ページ・投稿のページ・7-0・マイページ・ログインを、ブラウザで一度だけ開いて組み立てておく (島の部品も含めて)。
 */
setup('口コミまわりのページを先に組み立てる', async ({ page, context, baseURL }) => {
  const data = createTestDataScope();
  try {
    const event = await data.createEvent();
    const occurrence = await data.createOccurrence({
      eventId: event.id,
      verified: true,
      startsOn: jstDate(-10),
      endsOn: jstDate(20),
    });
    const author = await data.createMember();
    await data.admin.from('reviews').insert({
      occurrence_id: occurrence.id,
      user_id: author.userId,
      status: 'published',
      rating: 4,
      visited_on: jstDate(-1),
      attendance: 'walk_in',
    });
    const path = getOccurrenceUrl(
      { id: event.id, primaryCategory: { slug: event.categorySlug } },
      occurrence.slug
    );
    // ログインの画面を先に (未ログインで組み立てる)。その後は会員として、口コミまわりのページを開く
    await page.goto('/login?next=%2Freview');
    const member = await data.createMember();
    const { hostname } = new URL(baseURL!);
    await context.addCookies(
      (await sessionCookiesFor(member)).map(({ name, value }) => ({
        name,
        value,
        domain: hostname,
        path: '/',
        sameSite: 'Lax' as const,
      }))
    );
    for (const url of [path, `${path}/review`, '/review', `/review?q=warmup`, '/mypage']) {
      // 組み立ての途中の 500 は開き直す (ここで済ませておけば、並列のテストでは起きない)
      await expect(async () => {
        const response = await page.goto(url);
        expect(response?.status()).toBeLessThan(500);
      }).toPass({ timeout: 60_000 });
      await page.waitForLoadState('networkidle');
    }
  } finally {
    await data.cleanup();
  }
});
