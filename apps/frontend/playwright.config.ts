import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright (Layer5 = UI レイアウトの回帰検証)。
 *
 * `jest.config.mjs` の docstring が「UI コンポーネント = Layer5 Playwright は
 * 別系統」と宣言していた枠に入る。Jest の `testMatch` は `__tests__/` 配下のみを
 * 拾うため、`e2e/` に置いた本系統とは衝突しない。
 *
 * ## 🔴 CI では動かない (意図的)
 *
 * `.github/workflows/ci.yml` は `SKIP_ENV_VALIDATION: 'true'` でビルドしており
 * **Supabase の資格情報を持たない**。資格情報が無いと `/titles/{slug}` /
 * `/events/{id}` / `/venues/{slug}` の子パスが 1 本も生成されず (本番ビルドが
 * 23/23 になるのと同じ理由)、一覧も空になるため検証の対象そのものが消える。
 *
 * よって本系統は **「レイアウトを触る PR の前に手元で回す規律」であって
 * 「マージを止めるゲート」ではない**。CI 化には staging secrets の注入方式を
 * 決める必要があり、別タスクとして起票してある。
 *
 * ## 事前に必要なもの
 *
 * **staging を向いた dev サーバが 4444 で起動していること。**
 * `pnpm dev:stg` で起動する (`op run --env-file=.env.stg` が staging の値を
 * process.env に入れ、`.env.local` より優先させる。書式は `.env.sample` の冒頭)。
 *
 * ⚠️ `webServer` を設定していないのはこのため。素の `pnpm dev` はローカル Supabase
 *    (`supabase start`) を向く。ローカルのデータはフィクスチャだけなので、
 *    staging と同じ基準画像にはならない。
 *
 * ⚠️ production build と dev が `.next` を共有すると 500 になる。build の後に
 *    dev を起動するときは間に `rm -rf .next` を挟むこと。
 */
export default defineConfig({
  testDir: './e2e',

  // レイアウト計測は並列にしても速くならず、スクリーンショットの安定性だけが
  // 落ちる (同一 dev サーバへの同時アクセスで描画タイミングがぶれる)。
  workers: 1,
  fullyParallel: false,

  // 手元での実行が前提なので retry しない。落ちたら落ちたことを見せる。
  retries: 0,

  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:4444',
    // 失敗時だけ痕跡を残す (成功時に成果物を積み上げない)。
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    // ⚠️ 基準画像は **gitignored** (`.gitignore` の `**/e2e/**/*-snapshots/`、
    //    BOSS 判断 2026-08-25)。共有されないため、新しい作業コピーでは
    //    `pnpm test:visual --update-snapshots` を一度回して自分の基準を作る。
    toHaveScreenshot: {
      // フォントのアンチエイリアス差など、レイアウトと無関係な画素差を吸収する。
      // これより緩めると「1 カラムに戻った」レベルの崩れまで通ってしまう。
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },

  projects: [
    {
      name: 'chromium',
      // ビューポートは各テストが `page.setViewportSize` で明示するため、
      // ここでは既定値を置かない (幅がテストの主題なので暗黙にしない)。
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
