/**
 * `@sentry/nextjs` の jest 用手動 mock。
 *
 * @description
 * `jest.config.mjs` の `moduleNameMapper` から**常に**ここへ解決される。
 *
 * **なぜ transformIgnorePatterns を緩めないのか**: `@sentry/nextjs` は `@sentry/node` と
 * `@opentelemetry/*` の巨大な依存を引き込む。transform 対象にすると (a) テストが遅くなり、
 * (b) OTel は Node 固有 API に依存するため jsdom 環境では壊れる。
 * resolver 層で差し替えれば transform 自体が走らないため、1 行で決定的に解決できる。
 *
 * 各テストで `jest.mock()` を書く方式も却下した (書き忘れ 1 箇所で CI が謎に落ちるため)。
 */

export const init = jest.fn();
export const captureException = jest.fn();
export const captureMessage = jest.fn();
export const addBreadcrumb = jest.fn();
export const setTag = jest.fn();
export const setContext = jest.fn();
export const withScope = jest.fn((callback: (scope: unknown) => unknown) =>
  callback({
    setTag: jest.fn(),
    setContext: jest.fn(),
    setLevel: jest.fn(),
    setFingerprint: jest.fn(),
    setExtra: jest.fn(),
  })
);
export const startSpan = jest.fn(<T,>(_options: unknown, callback: () => T): T => callback());
export const flush = jest.fn(async () => true);
export const close = jest.fn(async () => true);
export const captureRequestError = jest.fn();
export const captureRouterTransitionStart = jest.fn();
