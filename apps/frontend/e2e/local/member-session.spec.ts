import { expect, test } from '@playwright/test';

/**
 * 保存したログイン状態の使い回しを確かめる。
 *
 * 口コミの E2E (下書き → 提出 → 公開 など) はすべて、この「会員としてページを開ける」ことの上に立つ。
 */
test('保存したログイン状態でマイページを開ける', async ({ page }) => {
  await page.goto('/mypage');

  await expect(page).toHaveURL(/\/mypage$/);
  await expect(page.getByRole('heading', { name: 'マイページ' })).toBeVisible();
  await expect(page.getByLabel('ユーザー名 (ID)')).toHaveValue(/^test_/);
});

test.describe('ログイン状態がない時', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('マイページを開くとログインへ送られる', async ({ page }) => {
    await page.goto('/mypage');

    await expect(page).toHaveURL(/\/login/);
  });
});
