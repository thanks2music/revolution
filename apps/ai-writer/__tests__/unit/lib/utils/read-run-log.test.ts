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

/**
 * 🔴 会場の網羅性ゲート (S1-d Phase 3.8 Step A) の判定行を AI 呼び出しと分離する。
 *
 * 混ざると `selectAdoptedRecord(records, 'detail-extraction')` が判定行を掴み、
 * `responseText` を持たないため `extractOccurrences` が `absent` を返して
 * **CLI が「測れなかった」と誤報し exit 1 になる**。
 */
describe('pipeline-event 行の分離', () => {
  const gateEventLine = JSON.stringify({
    kind: 'pipeline-event',
    runId: 'run-01',
    seq: 2,
    ts: '2026-08-14T00:00:00.000Z',
    event: 'venue-completeness-gate',
    relatedStepId: 'detail-extraction',
    payload: { status: 'passed', attemptCount: 2 },
  });

  it('records には混ぜず events へ振り分ける', async () => {
    const p = await writeJsonl('run.jsonl', [validLine, gateEventLine]);

    const { runLog, events, brokenLineCount } = readRunLog(p);

    expect(runLog.records).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('venue-completeness-gate');
    expect(brokenLineCount).toBe(0);
  });

  // ⚠️ 判定行は `stepId` というキーを持たない (`relatedStepId` を使う)。
  //    分離に漏れがあっても照合ツールに拾われないようにする二重の防御。
  it('判定行は stepId キーを持たない', async () => {
    const p = await writeJsonl('run.jsonl', [gateEventLine]);

    const { events } = readRunLog(p);

    expect(events[0]).not.toHaveProperty('stepId');
    expect(events[0].relatedStepId).toBe('detail-extraction');
  });

  // ★ 2026-08-14 より前のログには `kind` が無い。必須にすると既存ログが全滅する。
  it('kind の無い行は AI 呼び出しとして読む (既存ログの後方互換)', async () => {
    const p = await writeJsonl('run.jsonl', [validLine]);

    const { runLog, events } = readRunLog(p);

    expect(runLog.records).toHaveLength(1);
    expect(events).toHaveLength(0);
  });
});
