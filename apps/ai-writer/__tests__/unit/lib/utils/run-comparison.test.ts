import { describe, expect, it } from '@jest/globals';

import type { AiCallRecord } from '@/lib/ai/observability/ai-call-recorder';
import {
  classifyFailureNature,
  compareOccurrences,
  compareRuns,
  compareSteps,
  extractVenueLabels,
  formatRunComparison,
  type RunLog,
} from '@/lib/utils/run-comparison';

/** 最小限のレコードを組み立てる。 */
function record(overrides: Partial<AiCallRecord> & { stepId: AiCallRecord['stepId'] }): AiCallRecord {
  return {
    runId: 'run',
    seq: 1,
    ts: '2026-08-12T00:00:00.000Z',
    provider: 'openai',
    requestedModel: 'gpt-5.4-mini',
    resolvedModel: 'gpt-5.4-mini-2026-03-17',
    systemFingerprint: null,
    latencyMs: 1000,
    promptSha256: 'p'.repeat(64),
    promptChars: 100,
    ...overrides,
  };
}

/** `detail-extraction` の応答 (Structured Outputs の JSON) を作る。 */
function extractionResponse(venues: { name: string; start?: string | null; end?: string | null }[]): string {
  return JSON.stringify({
    event_data: {
      occurrences: venues.map((v) => ({
        venue_label: v.name,
        starts_on: v.start ?? null,
        ends_on: v.end ?? null,
      })),
    },
  });
}

function run(label: string, venues: { name: string }[], responseSha: string): RunLog {
  return {
    label,
    records: [
      record({ stepId: 'article-selection', responseSha256: 'a'.repeat(64) }),
      record({
        stepId: 'detail-extraction',
        responseSha256: responseSha,
        responseText: extractionResponse(venues),
      }),
    ],
  };
}

describe('extractVenueLabels', () => {
  it('occurrences から会場名を取り出す', () => {
    const rec = record({
      stepId: 'detail-extraction',
      responseText: extractionResponse([{ name: '東京店' }, { name: '大阪店' }]),
    });
    expect(extractVenueLabels(rec)).toEqual(['東京店', '大阪店']);
  });

  it('応答が壊れていても throw せず空配列を返す', () => {
    // 比較ツールがログの不備で落ちると、調べたい対象そのものを見られなくなる。
    const rec = record({ stepId: 'detail-extraction', responseText: '{壊れた JSON' });
    expect(extractVenueLabels(rec)).toEqual([]);
  });

  it('レコードが無い場合も空配列', () => {
    expect(extractVenueLabels(undefined)).toEqual([]);
  });
});

describe('compareSteps', () => {
  const runs = [
    run('run-01', [{ name: '東京店' }], 'x'.repeat(64)),
    run('run-02', [{ name: '東京店' }], 'y'.repeat(64)),
  ];

  it('同一プロンプトで出力だけ割れたことを示す', () => {
    const steps = compareSteps(runs);
    const detail = steps.find((s) => s.stepId === 'detail-extraction')!;

    // ★ これが「同一入力で出力が変わる」の機械判定。前セッションは
    //   shasum を手打ちして確かめていた。
    expect(detail.promptIdentical).toBe(true);
    expect(detail.responseIdentical).toBe(false);
    expect(detail.responseShas).toHaveLength(2);
  });

  it('要求モデルと応答モデルを分けて並べる', () => {
    const detail = compareSteps(runs).find((s) => s.stepId === 'detail-extraction')!;
    expect(detail.requestedModels).toEqual(['gpt-5.4-mini']);
    expect(detail.resolvedModels).toEqual(['gpt-5.4-mini-2026-03-17']);
  });

  it('応答モデルが割れていれば複数並ぶ (モデル基盤の変化)', () => {
    const mixed: RunLog[] = [
      { label: 'r1', records: [record({ stepId: 'detail-extraction', resolvedModel: 'gpt-5.4-mini-2026-03-17' })] },
      { label: 'r2', records: [record({ stepId: 'detail-extraction', resolvedModel: 'gpt-5.4-mini-2026-05-01' })] },
    ];
    const detail = compareSteps(mixed).find((s) => s.stepId === 'detail-extraction')!;
    expect(detail.resolvedModels).toHaveLength(2);
  });

  it('失敗した実行を名指しする', () => {
    const withError: RunLog[] = [
      { label: 'ok', records: [record({ stepId: 'detail-extraction' })] },
      { label: 'ng', records: [record({ stepId: 'detail-extraction', error: 'HTTP 500' })] },
    ];
    const detail = compareSteps(withError).find((s) => s.stepId === 'detail-extraction')!;
    expect(detail.erroredRuns).toEqual(['ng']);
  });

  it('所要時間の幅を出す', () => {
    const timed: RunLog[] = [
      { label: 'r1', records: [record({ stepId: 'detail-extraction', latencyMs: 6893 })] },
      { label: 'r2', records: [record({ stepId: 'detail-extraction', latencyMs: 7665 })] },
    ];
    const detail = compareSteps(timed).find((s) => s.stepId === 'detail-extraction')!;
    expect(detail.latencyMsRange).toEqual([6893, 7665]);
  });
});

describe('compareOccurrences', () => {
  it('全実行で会場集合が同じなら一致と判定', () => {
    const result = compareOccurrences([
      run('r1', [{ name: '東京店' }, { name: '大阪店' }], 'a'.repeat(64)),
      run('r2', [{ name: '大阪店' }, { name: '東京店' }], 'b'.repeat(64)),
    ])!;

    // 順序が違っても集合として同じなら一致
    expect(result.venueSetIdentical).toBe(true);
    expect(result.sometimesPresent).toEqual([]);
  });

  it('一部の実行にしか出ない会場を名指しする', () => {
    // 実測 (kusuriya): 大阪が 3 回中 1 回だけ出た
    const result = compareOccurrences([
      run('r1', [{ name: '東京店' }], 'a'.repeat(64)),
      run('r2', [{ name: '東京店' }], 'b'.repeat(64)),
      run('r3', [{ name: '東京店' }, { name: '大阪店' }], 'c'.repeat(64)),
    ])!;

    expect(result.venueSetIdentical).toBe(false);
    expect(result.alwaysPresent).toEqual(['東京店']);
    expect(result.sometimesPresent).toEqual(['大阪店']);
  });

  it('occurrences がどの実行にも無ければ null', () => {
    const result = compareOccurrences([
      { label: 'r1', records: [record({ stepId: 'article-selection' })] },
    ]);
    expect(result).toBeNull();
  });
});

describe('classifyFailureNature', () => {
  it('全実行が不合格なら系統的', () => {
    // 再実行では救えない。プロンプト・セレクタの是正が要る = Phase 3.6 の本体
    expect(classifyFailureNature([false, false, false])).toBe('systematic');
  });

  it('一部が合格なら確率的', () => {
    // 再実行が正当な回復手段になる = Phase 3.6 の対象外
    expect(classifyFailureNature([false, true, false])).toBe('probabilistic');
  });

  it('全実行が合格なら all-passed', () => {
    expect(classifyFailureNature([true, true, true])).toBe('all-passed');
  });

  it('合否が渡されなければ判定しない', () => {
    // ★ 自己一貫性から正しさを推定しない。3 回とも同じように会場を落とせば
    //   「完全に一致」だが「安定して間違っている」。
    expect(classifyFailureNature([])).toBe('not-evaluated');
  });
});

describe('compareRuns / formatRunComparison', () => {
  const runs = [
    run('run-01', [{ name: '東京店' }], 'a'.repeat(64)),
    run('run-02', [{ name: '東京店' }], 'b'.repeat(64)),
    run('run-03', [{ name: '東京店' }, { name: '大阪店' }], 'c'.repeat(64)),
  ];

  it('合否を渡すと歩留まりを添える (合否そのものには使わない)', () => {
    const comparison = compareRuns(runs, [false, false, false]);
    expect(comparison.nature).toBe('systematic');
    expect(comparison.passRate).toEqual({ passed: 0, total: 3 });
  });

  it('合否を渡さない場合は判定しないことを明示する', () => {
    const text = formatRunComparison(compareRuns(runs));
    expect(text).toContain('判定なし');
    expect(text).toContain('自己一貫性だけでは');
  });

  it('未供給の fingerprint を「null (未供給)」と書く', () => {
    // 実測で OpenAI が gpt-5.4-mini に対し system_fingerprint を返さないため、
    // 「記録し忘れ」と読ませない表記にしておく。
    const text = formatRunComparison(compareRuns(runs));
    expect(text).toContain('null (未供給)');
  });

  it('揺れている会場を報告に出す', () => {
    const text = formatRunComparison(compareRuns(runs));
    expect(text).toContain('実行によって出たり出なかったりする会場');
    expect(text).toContain('大阪店');
  });
});
