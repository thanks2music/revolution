/**
 * Layer 2: `enrichExtractedDataForPrompt` の Sentry 計装コントラクト。
 *
 * この catch は **記事を生成し続けたまま品質だけ落とす** silent fallback で、
 * コード内コメントが「Sprint C-β P10 で Sentry に promote 予定」と明記していた箇所。
 * level は warning 止まりにしてある — 記事生成は継続しており「誰かが起きて対応すべき」
 * ではないため (warning = Medium = メール通知の対象外)。
 *
 * ⚠️ **本体の `content-generation.service.test.ts` とは別ファイルにしている。**
 * 「正常時は captureMessage しない」を検証するには enrich を成功させる必要があるが、
 * 実体の `getMediaTypeMapperService()` / `getMediaFormResolverService()` は
 * `apps/ai-writer/templates/config/*.yaml` を読む。この YAML は gitignored で
 * **CI ランナーには存在しない**ため、mock 無しでは CI だけ catch に落ちて
 * 「呼ばれないはず」が反転する。本ファイルで両サービスを mock して環境非依存にする。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';

const mockResolve = jest.fn<(a: unknown, b: unknown) => string>();
const mockGetLabel = jest.fn<(a: unknown) => string>();

// YAML を読ませない (CI に fixture が無いため)
jest.mock('@/lib/services/media-form-resolver.service', () => ({
  getMediaFormResolverService: () => ({ resolve: mockResolve }),
}));
jest.mock('@/lib/services/media-type-mapper.service', () => ({
  getMediaTypeMapperService: () => ({ getLabel: mockGetLabel }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ContentGenerationService } = require('@/lib/services/content-generation.service');

/** private メソッドを取り出す (既存 suite と同じ手法)。 */
const getEnrich = (service: unknown) =>
  (service as { enrichExtractedDataForPrompt: (d: unknown) => unknown })
    .enrichExtractedDataForPrompt.bind(service);

const extracted = {
  原作タイプ: 'manga_based',
  メディアタイプ: 'manga',
  原作者名: '作者名',
};

let service: unknown;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockResolve.mockReturnValue('漫画');
  mockGetLabel.mockReturnValue('漫画');
  // テンプレートローダーと AI provider は enrich では使われないので最小の空実装で足りる
  service = new ContentGenerationService({} as never, {} as never);
});

describe('enrichExtractedDataForPrompt の Sentry 計装', () => {
  it('enrich が落ちたら warning として captureMessage する', () => {
    mockResolve.mockImplementation(() => {
      throw new Error('config load failed');
    });

    // 振る舞いは従来どおり: 入力をそのまま返して記事生成は続行する
    expect(getEnrich(service)(extracted)).toBe(extracted);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string> },
    ];
    // error に格上げすると、fallback が起きるたびにメール通知が飛ぶ
    expect(options.level).toBe('warning');
    expect(options.tags.pipeline).toBe('mdx');
  });

  it('正常時は captureMessage しない', () => {
    const result = getEnrich(service)(extracted) as Record<string, unknown>;

    // enrich が成功していること (fallback ではないこと) を確認してから
    expect(result.メディアタイプ).toBe('漫画');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
