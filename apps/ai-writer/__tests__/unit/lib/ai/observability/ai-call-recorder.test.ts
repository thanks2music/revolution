import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  MAX_INLINE_RESPONSE_CHARS,
  formatPromptPointer,
  getAiCallJsonlPath,
  initAiCallRecorder,
  isAiCallRecordingEnabled,
  recordAiCall,
  resetAiCallRecorderForTest,
  shouldSuppressInlinePromptDump,
  type AiCallRecord,
} from '@/lib/ai/observability/ai-call-recorder';

/**
 * 一時ディレクトリにログファイルの「置き場所」を作る。実ファイルは作らない
 * (recorder 側が親ディレクトリを掘る挙動も検証対象のため)。
 */
async function makeTempLogPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-call-recorder-'));
  return path.join(dir, '2026-08-12-example-com-01.log');
}

/** JSONL を 1 行ずつ parse して返す。 */
async function readRecords(jsonlPath: string): Promise<AiCallRecord[]> {
  const raw = await fs.readFile(jsonlPath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AiCallRecord);
}

const ENV_KEYS = ['DEBUG_AI_STEPS', 'NODE_ENV'] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetAiCallRecorderForTest();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetAiCallRecorderForTest();
});

describe('isAiCallRecordingEnabled', () => {
  it('未初期化かつ DEBUG_AI_STEPS 未設定なら無効', () => {
    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(false);
  });

  it('明示初期化すれば DEBUG_* が 1 つも無くても全ステップが有効になる', async () => {
    // ★ ここが本モジュールの要点。従来は 11 個の DEBUG_* フラグに依存しており、
    //   DEBUG_EXTRACTION_PROMPT だけが未設定だったために最重要ステップのログが
    //   丸ごと欠落していた。--log を付けた時点で全ステップが記録される。
    initAiCallRecorder(await makeTempLogPath());

    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(true);
    expect(isAiCallRecordingEnabled('title-generation')).toBe(true);
    expect(isAiCallRecordingEnabled('unknown')).toBe(true);
  });

  it('DEBUG_AI_STEPS=all なら未初期化でも全ステップが有効', () => {
    process.env.DEBUG_AI_STEPS = 'all';
    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(true);
    expect(isAiCallRecordingEnabled('content-generation')).toBe(true);
  });

  it('DEBUG_AI_STEPS にステップ ID を並べると、そのステップだけが有効', () => {
    process.env.DEBUG_AI_STEPS = 'detail-extraction, title-generation';
    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(true);
    expect(isAiCallRecordingEnabled('title-generation')).toBe(true);
    expect(isAiCallRecordingEnabled('content-generation')).toBe(false);
  });

  it('空文字や空要素だけの指定は「未設定」と同じ扱い', () => {
    process.env.DEBUG_AI_STEPS = '  ,  ,';
    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(false);
  });

  it('NODE_ENV=production では初期化済みでも無効', async () => {
    // Cloud Run の FS は ephemeral で再起動時に消えるため、書いても復元できない。
    // claude-vision.service.ts の saveLogToFile と同じ判断。
    initAiCallRecorder(await makeTempLogPath());
    process.env.NODE_ENV = 'production';

    expect(isAiCallRecordingEnabled('detail-extraction')).toBe(false);
  });
});

describe('shouldSuppressInlinePromptDump', () => {
  it('recorder が有効なら本体ログへの全文出力を抑止する', async () => {
    initAiCallRecorder(await makeTempLogPath());
    expect(shouldSuppressInlinePromptDump('title-generation')).toBe(true);
  });

  it('recorder が無効なら従来どおり DEBUG_* の判断に委ねる (抑止しない)', () => {
    expect(shouldSuppressInlinePromptDump('title-generation')).toBe(false);
  });
});

describe('recordAiCall', () => {
  it('JSONL を .log と同じ basename で並べ、プロンプトは別ファイルへ退避する', async () => {
    const logPath = await makeTempLogPath();
    initAiCallRecorder(logPath);

    const prompt = 'プロンプト本文'.repeat(100);
    await recordAiCall({
      stepId: 'detail-extraction',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      resolvedModel: 'gpt-5.4-mini-2026-01-30',
      systemFingerprint: 'fp_abc123',
      finishReason: 'stop',
      latencyMs: 1234,
      requestId: 'chatcmpl-xyz',
      temperature: 0.2,
      prompt,
      promptSha256: 'dummy-prompt-hash',
      promptChars: prompt.length,
      responseSha256: 'dummy-response-hash',
      responseChars: 5,
      responseText: '{"a":1}',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });

    const jsonlPath = getAiCallJsonlPath()!;
    expect(path.basename(jsonlPath)).toBe('2026-08-12-example-com-01.jsonl');

    const records = await readRecords(jsonlPath);
    expect(records).toHaveLength(1);

    const record = records[0];
    expect(record.runId).toBe('2026-08-12-example-com-01');
    expect(record.seq).toBe(1);
    expect(record.stepId).toBe('detail-extraction');
    // 要求モデルと応答モデルが両方残ること。alias の解決先が変わっても気づける。
    expect(record.requestedModel).toBe('gpt-5.4-mini');
    expect(record.resolvedModel).toBe('gpt-5.4-mini-2026-01-30');
    expect(record.systemFingerprint).toBe('fp_abc123');
    expect(record.responseText).toBe('{"a":1}');

    // プロンプト全文はレコードに入らず、ファイルへ出ていること
    expect((record as unknown as { prompt?: string }).prompt).toBeUndefined();
    expect(record.promptFile).toBeDefined();
    const promptFileAbs = path.resolve(process.cwd(), record.promptFile!);
    await expect(fs.readFile(promptFileAbs, 'utf-8')).resolves.toBe(prompt);
  });

  // ★ 切り捨ての境界は「測れなかった」を「正しかった」と混同させない要点。
  //   `responseTruncated` が立たない切り捨てが起きると、比較側は不完全な JSON を
  //   parse 失敗として扱い、**系統的失敗として誤って帰属する**。
  it('上限ちょうどの応答は全文保持し、responseTruncated を立てない', async () => {
    initAiCallRecorder(await makeTempLogPath());

    const responseText = 'x'.repeat(MAX_INLINE_RESPONSE_CHARS);
    await recordAiCall({
      stepId: 'content-generation',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      latencyMs: 10,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
      responseText,
      responseChars: responseText.length,
    });

    const [record] = await readRecords(getAiCallJsonlPath()!);
    expect(record.responseText).toHaveLength(MAX_INLINE_RESPONSE_CHARS);
    expect(record.responseText).toBe(responseText);
    expect(record.responseTruncated).toBeUndefined();
  });

  it('上限を 1 文字超えたら切り捨て、responseTruncated を立てる', async () => {
    initAiCallRecorder(await makeTempLogPath());

    const responseText = 'y'.repeat(MAX_INLINE_RESPONSE_CHARS + 1);
    await recordAiCall({
      stepId: 'content-generation',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      latencyMs: 10,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
      responseText,
      responseChars: responseText.length,
    });

    const [record] = await readRecords(getAiCallJsonlPath()!);
    expect(record.responseTruncated).toBe(true);
    expect(record.responseText).toHaveLength(MAX_INLINE_RESPONSE_CHARS);
    // 切り捨て前の実長は responseChars に残ること (ここが消えると「どれだけ失ったか」が分からない)
    expect(record.responseChars).toBe(MAX_INLINE_RESPONSE_CHARS + 1);
  });

  it('system_fingerprint 非対応の provider は null で記録し、未記録と区別できる', async () => {
    initAiCallRecorder(await makeTempLogPath());

    await recordAiCall({
      stepId: 'title-generation',
      provider: 'anthropic',
      requestedModel: 'claude-x',
      systemFingerprint: null,
      latencyMs: 10,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
    });

    const [record] = await readRecords(getAiCallJsonlPath()!);
    // undefined (未記録) ではなく null (非対応) であること
    expect(record.systemFingerprint).toBeNull();
    expect('systemFingerprint' in record).toBe(true);
  });

  it('失敗した呼び出しも成功と同じ平面に残す', async () => {
    // 成功だけ残すと「N 回中 M 回失敗」を後から数えられず、歩留まりが測れない。
    initAiCallRecorder(await makeTempLogPath());

    await recordAiCall({
      stepId: 'detail-extraction',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      latencyMs: 42,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
      error: 'HTTP 500',
    });

    const [record] = await readRecords(getAiCallJsonlPath()!);
    expect(record.error).toBe('HTTP 500');
    expect(record.responseText).toBeUndefined();
  });

  it('複数回の記録が seq で通し番号になり、1 ファイルに追記される', async () => {
    initAiCallRecorder(await makeTempLogPath());

    for (const stepId of ['article-selection', 'detail-extraction', 'detail-extraction'] as const) {
      await recordAiCall({
        stepId,
        provider: 'openai',
        requestedModel: 'gpt-5.4-mini',
        latencyMs: 1,
        prompt: `prompt-${stepId}`,
        promptSha256: 'h',
        promptChars: 1,
      });
    }

    const records = await readRecords(getAiCallJsonlPath()!);
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3]);
    // 同一ステップが 2 回呼ばれても退避先が衝突しないこと
    const files = new Set(records.map((r) => r.promptFile));
    expect(files.size).toBe(3);
  });

  it('context に使用 URL と未使用候補を載せられる (Phase 3.5 F)', async () => {
    initAiCallRecorder(await makeTempLogPath());

    await recordAiCall({
      stepId: 'detail-extraction',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      latencyMs: 1,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
      context: {
        usedUrl: 'https://example.com/lp/tokyo',
        candidateUrls: ['https://example.com/lp/tokyo', 'https://example.com/lp/osaka'],
        unusedUrls: ['https://example.com/lp/osaka'],
        inputHtmlChars: 16271,
        inputHtmlSha256: '12373dac',
      },
    });

    const [record] = await readRecords(getAiCallJsonlPath()!);
    // 候補に大阪があるのに東京だけが使われた、が 1 レコードで判定できること
    expect(record.context?.usedUrl).toBe('https://example.com/lp/tokyo');
    expect(record.context?.unusedUrls).toEqual(['https://example.com/lp/osaka']);
    expect(record.context?.inputHtmlSha256).toBe('12373dac');
  });

  it('無効時は何も書かない', async () => {
    const logPath = await makeTempLogPath();
    // init しない = 無効
    await recordAiCall({
      stepId: 'detail-extraction',
      provider: 'openai',
      requestedModel: 'gpt-5.4-mini',
      latencyMs: 1,
      prompt: 'p',
      promptSha256: 'h',
      promptChars: 1,
    });

    const jsonlPath = logPath.replace(/\.log$/, '.jsonl');
    await expect(fs.access(jsonlPath)).rejects.toThrow();
  });
});

describe('formatPromptPointer', () => {
  it('文字数と短縮ハッシュを含む 1 行を返す', () => {
    const line = formatPromptPointer({
      stepId: 'detail-extraction',
      prompt: 'a'.repeat(12345),
      promptFile: 'logs/prompts/run-01-detail-extraction.txt',
    });

    expect(line).toContain('[detail-extraction]');
    expect(line).toContain('logs/prompts/run-01-detail-extraction.txt');
    expect(line).toContain('12,345 chars');
    expect(line).toMatch(/sha256 [0-9a-f]{12}/);
  });

  it('退避先が無い場合でもハッシュだけは出す', () => {
    const line = formatPromptPointer({ stepId: 'unknown', prompt: 'x' });
    expect(line).toContain('[unknown]');
    expect(line).not.toContain('→');
    expect(line).toMatch(/sha256 [0-9a-f]{12}/);
  });
});
