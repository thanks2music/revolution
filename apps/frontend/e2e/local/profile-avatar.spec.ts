import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';

import { sessionCookiesFor } from '../../test-support/member-session';
import {
  createTestDataScope,
  type TestDataScope,
  type TestMember,
} from '../../test-support/test-data';

/**
 * プロフィール画像とプロフィール編集 (one-more-time #171)。置き場所と審査器は偽物
 * (REVIEW_PHOTO_STORAGE=fake・REVIEW_SCREENER=fake。審査は画像の左上の色で決まる: 赤 = 落とす)。
 * 画像と名前を変えるので、共有の会員ではなく自分専用の会員を作る
 */
let data: TestDataScope;

test.beforeEach(() => {
  data = createTestDataScope();
});
test.afterEach(async () => {
  await data.cleanup();
});

async function signIn(context: BrowserContext, member: TestMember, baseURL: string) {
  const { hostname } = new URL(baseURL);
  const cookies = await sessionCookiesFor(member);
  await context.clearCookies();
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      domain: hostname,
      path: '/',
      sameSite: 'Lax' as const,
    }))
  );
}

async function jpeg(background: string) {
  return {
    name: 'avatar.jpg',
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 400, height: 300, channels: 3, background } })
      .jpeg()
      .toBuffer(),
  };
}

/**
 * 画像を選んで上げる。上げ終わると欄が画面を読み直す (状態が変わる)。それを待ってから次に進む
 * (途中で開き直すと、上げている通信が止まる)
 */
async function chooseAvatar(page: Page, color: string) {
  // 組み立てが済む (React が欄に結び付く) 前に選ぶと、選んだことが欄に届かない
  await page.waitForLoadState('networkidle');
  const field = page.getByTestId('avatar-field');
  const before = await field.getAttribute('data-status');
  await page.locator('input[type="file"]').setInputFiles(await jpeg(color));
  await expect(field).not.toHaveAttribute('data-status', before ?? '', { timeout: 20_000 });
}

/** 審査は応答の後に走るので、開き直して状態が変わるのを待つ */
async function expectAvatarStatus(page: Page, status: string) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('avatar-field')).toHaveAttribute('data-status', status, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

test('プロフィール編集で画像を設定し、通ると公開、落ちると理由が出て、外せる', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  await page.goto('/mypage/profile');
  await expect(page.getByRole('heading', { name: 'プロフィールを編集' })).toBeVisible();

  // 通る画像 (緑)
  await chooseAvatar(page, '#3a9b5c');
  await expectAvatarStatus(page, 'published');
  await expect(page.getByRole('button', { name: '画像を外す' })).toBeVisible();

  // 落ちる画像 (赤) に替える
  await chooseAvatar(page, '#ff0000');
  await expectAvatarStatus(page, 'rejected');
  await expect(page.getByText('性的・暴力的な表現が含まれていました')).toBeVisible();
  await expect(page.getByText('別の画像を選ぶ')).toBeVisible();

  // マイページにも理由が出る
  await page.goto('/mypage');
  await expect(page.getByText('プロフィール画像を表示できませんでした')).toBeVisible();

  // 選び直して、外す
  await page.goto('/mypage/profile');
  await chooseAvatar(page, '#3a9b5c');
  await expectAvatarStatus(page, 'published');
  await page.getByRole('button', { name: '画像を外す' }).click();
  // 外すと欄が画面を読み直す (開き直すと、外す通信が止まる)
  await expect(page.getByTestId('avatar-field')).toHaveAttribute('data-status', 'none', {
    timeout: 20_000,
  });
});

test('表示名とユーザー名を変えて保存すると、マイページに戻る', async ({
  page,
  context,
  baseURL,
}) => {
  const member = await data.createMember();
  await signIn(context, member, baseURL!);
  await page.goto('/mypage/profile');

  const newName = `test_${Date.now().toString(36)}`;
  await page.getByLabel('表示名').fill('新しい名前');
  await page.getByLabel('ユーザー名 (ID)').fill(newName);
  await page.getByRole('button', { name: '保存する' }).click();

  await expect(page).toHaveURL(/\/mypage$/);
  await expect(page.getByText('新しい名前')).toBeVisible();
  await expect(page.getByText(`@${newName}`)).toBeVisible();
});
