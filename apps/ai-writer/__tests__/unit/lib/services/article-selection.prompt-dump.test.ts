/**
 * `shouldSuppressInlinePromptDump` の**サービス側配線**を固定する Layer 2 テスト。
 *
 * 関数そのものは `ai-call-recorder.test.ts` でテスト済み。ここで検証するのは
 * 「サービスが実際にその判定を見ているか」という配線で、抑止が効かないと
 * **同じプロンプト全文が本体ログと `logs/prompts/` に二重で出る**。
 *
 * 4 サービス (article-selection / title-generation / extraction / content-generation) が
 * 同一形の 2 項条件を持つため、代表 1 つで形を固定する。あわせて 4 箇所すべてが
 * 判定を呼んでいることを drift guard で確認する。
 */

import { readFileSync } from 'fs';
import * as path from 'path';

import { shouldSuppressInlinePromptDump } from '@/lib/ai/observability/ai-call-recorder';
import { ArticleSelectionService } from '@/lib/services/article-selection.service';

jest.mock('@/lib/ai/observability/ai-call-recorder', () => ({
  shouldSuppressInlinePromptDump: jest.fn(() => false),
  recordAiCall: jest.fn(async () => {}),
  hashForAiCallRecord: (v: string) => `sha-${v.length}`,
}));

const mockedShouldSuppress = shouldSuppressInlinePromptDump as unknown as jest.Mock;

/** プロンプト全文の出力を囲む区切り行。これが出たかどうかで判定する。 */
const DUMP_MARKER = '送信プロンプト全文';

const VALID_RESPONSE = JSON.stringify({
  should_generate: true,
  primary_official_url: 'https://example.com/',
  official_urls: ['https://example.com/'],
  reason: 'テスト',
});

/** buildPrompt が参照する最小限のテンプレート。 */
function buildStubTemplate() {
  return {
    prompts: { selection: 'テスト用プロンプト' },
    logic: {},
    output: {},
  };
}

function buildService() {
  const templateLoader = {
    loadModularTemplate: jest.fn(async () => buildStubTemplate()),
  };
  const aiProvider = {
    sendMessage: jest.fn(async () => ({ content: VALID_RESPONSE, model: 'gpt-5.4-mini' })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ArticleSelectionService(templateLoader as any, aiProvider as any);
  return { service, aiProvider };
}

let logSpy: jest.SpyInstance;
const savedFlag = process.env.DEBUG_SELECTION_PROMPT;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  mockedShouldSuppress.mockReturnValue(false);
});

afterEach(() => {
  logSpy.mockRestore();
  jest.clearAllMocks();
  if (savedFlag === undefined) delete process.env.DEBUG_SELECTION_PROMPT;
  else process.env.DEBUG_SELECTION_PROMPT = savedFlag;
});

/** console.log の全出力に区切り行が含まれるか。 */
function dumpWasPrinted(): boolean {
  return logSpy.mock.calls.some((call) => call.some((arg) => String(arg).includes(DUMP_MARKER)));
}

describe('article-selection のプロンプト全文出力の抑止', () => {
  it('DEBUG_SELECTION_PROMPT=true かつ抑止なしなら全文を出す', async () => {
    process.env.DEBUG_SELECTION_PROMPT = 'true';
    mockedShouldSuppress.mockReturnValue(false);

    const { service } = buildService();
    await service.shouldGenerateArticle({ rss_title: 't', rss_content: 'c' });

    expect(dumpWasPrinted()).toBe(true);
  });

  // ★ recorder が有効なら同じ内容が logs/prompts/ に残る。本体ログ側は抑止してよい。
  //   情報は失われず、置き場所が変わるだけ。
  it('DEBUG_SELECTION_PROMPT=true でも抑止が有効なら全文を出さない', async () => {
    process.env.DEBUG_SELECTION_PROMPT = 'true';
    mockedShouldSuppress.mockReturnValue(true);

    const { service } = buildService();
    await service.shouldGenerateArticle({ rss_title: 't', rss_content: 'c' });

    expect(dumpWasPrinted()).toBe(false);
    expect(mockedShouldSuppress).toHaveBeenCalledWith('article-selection');
  });

  it('DEBUG_SELECTION_PROMPT が未設定なら抑止判定に関わらず出さない', async () => {
    delete process.env.DEBUG_SELECTION_PROMPT;
    mockedShouldSuppress.mockReturnValue(false);

    const { service } = buildService();
    await service.shouldGenerateArticle({ rss_title: 't', rss_content: 'c' });

    expect(dumpWasPrinted()).toBe(false);
  });
});

describe('抑止判定の適用漏れ (drift guard)', () => {
  // ★ 「同じ手当てを一部にしか適用していない」状態を防ぐ。旧 DEBUG_*_PROMPT フラグは
  //   11 個に分裂し、DEBUG_EXTRACTION_PROMPT だけが未設定だったために最重要ステップの
  //   ログが残らない状態が続いた (本モジュール群を作った直接の原因)。
  const SERVICES_WITH_PROMPT_DUMP = [
    'article-selection.service.ts',
    'title-generation.service.ts',
    'extraction.service.ts',
    'content-generation.service.ts',
  ] as const;

  /**
   * `DEBUG_*_PROMPT === 'true'` を含む分岐をすべて拾い、抑止判定と AND されているかを見る。
   *
   * 「ファイル内に 1 回でも呼んでいれば OK」だと、同じファイルに 2 つ目のダンプを足した
   * ときに片方だけ抑止が効かない状態を見逃す (`title-generation.service.ts` の
   * reasoning 出力で実際に起きた)。**条件式の単位**で検査する。
   */
  it.each(SERVICES_WITH_PROMPT_DUMP)('%s の全ダンプ分岐が抑止判定と AND されている', (fileName) => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../../lib/services', fileName),
      'utf-8'
    );

    // `if (...)` の中身を丸ごと取り、DEBUG_*_PROMPT を含むものだけを対象にする
    const conditions = [...source.matchAll(/if\s*\(([\s\S]*?)\)\s*\{/g)]
      .map((m) => m[1])
      .filter((cond) => /DEBUG_[A-Z_]*PROMPT\s*===\s*'true'/.test(cond));

    expect(conditions.length).toBeGreaterThan(0);
    for (const cond of conditions) {
      expect(cond).toMatch(/!shouldSuppressInlinePromptDump\('[a-z-]+'\)/);
    }
  });
});
