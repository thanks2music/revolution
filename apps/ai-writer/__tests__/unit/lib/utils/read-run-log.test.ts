import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readRunLog } from '@/lib/utils/read-run-log';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-run-log-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** JSONL を書き出してパスを返す。 */
async function writeJsonl(name: string, lines: string[]): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, lines.join('\n'), 'utf-8');
  return p;
}

const validLine = JSON.stringify({
  runId: 'run-01',
  seq: 1,
  ts: '2026-08-12T00:00:00.000Z',
  stepId: 'detail-extraction',
  provider: 'openai',
  requestedModel: 'gpt-5.4-mini',
  latencyMs: 100,
  promptSha256: 'p',
  promptChars: 1,
});

describe('readRunLog', () => {
  it('label はファイル名から拡張子を除いたもの', async () => {
    const p = await writeJsonl('2026-08-12-example-com-01.jsonl', [validLine]);

    const { runLog, brokenLineCount } = readRunLog(p);

    expect(runLog.label).toBe('2026-08-12-example-com-01');
    expect(runLog.records).toHaveLength(1);
    expect(brokenLineCount).toBe(0);
  });

  // ★ 素で JSON.parse すると 1 行の破損で全体が throw し、CI から見た exit 1 が
  //   「本物の不一致を見つけた」と区別できなくなる。
  it('壊れた行があっても throw せず、正常な行は読める', async () => {
    const p = await writeJsonl('run.jsonl', [validLine, '{途中で切れた', validLine]);

    const { runLog, brokenLineCount } = readRunLog(p);

    expect(runLog.records).toHaveLength(2);
    expect(brokenLineCount).toBe(1);
  });

  it('壊れた行の件数を返す (黙って捨てない)', async () => {
    const p = await writeJsonl('run.jsonl', ['{a', '{b', validLine]);

    expect(readRunLog(p).brokenLineCount).toBe(2);
  });

  it('空行は破損として数えない', async () => {
    const p = await writeJsonl('run.jsonl', [validLine, '', '   ', validLine]);

    const { runLog, brokenLineCount } = readRunLog(p);

    expect(runLog.records).toHaveLength(2);
    expect(brokenLineCount).toBe(0);
  });

  it('全行が壊れていても throw しない', async () => {
    const p = await writeJsonl('run.jsonl', ['{a', '{b']);

    const { runLog, brokenLineCount } = readRunLog(p);

    expect(runLog.records).toEqual([]);
    expect(brokenLineCount).toBe(2);
  });
});
