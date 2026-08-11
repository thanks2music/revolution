import { describe, expect, it } from '@jest/globals';

import type { AiCallRecord } from '@/lib/ai/observability/ai-call-recorder';
import {
  classifyFailureNature,
  compareOccurrences,
  compareRuns,
  compareSteps,
  extractOccurrences,
  formatRunComparison,
  venueLabelsOf,
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

describe('extractOccurrences', () => {
  it('occurrences から会場名と期間を取り出す', () => {
    const rec = record({
      stepId: 'detail-extraction',
      responseText: extractionResponse([
        { name: '東京店', start: '2026-05-14', end: '2026-07-05' },
        { name: '大阪店' },
      ]),
    });

    const extraction = extractOccurrences(rec);
    expect(extraction.status).toBe('ok');
    expect(venueLabelsOf(extraction)).toEqual(['東京店', '大阪店']);
    // ★ キー名は wire format (snake_case) のまま。camelCase に変換すると
    //   `compareWithSource` へ渡したときに全会場が「欠落」になる。
    expect(extraction).toMatchObject({
      occurrences: [
        { venue_label: '東京店', starts_on: '2026-05-14', ends_on: '2026-07-05' },
        { venue_label: '大阪店', starts_on: null, ends_on: null },
      ],
    });
  });

  // ★ ここが本 PR の主張の核心。「測れなかった」を「0 件だった」に潰すと、
  //   観測の欠損が系統的失敗として誤って帰属される。
  it('応答が壊れていても throw せず unparseable で返す (空配列に潰さない)', () => {
    const rec = record({ stepId: 'detail-extraction', responseText: '{壊れた JSON' });
    const extraction = extractOccurrences(rec);

    expect(extraction.status).toBe('unparseable');
    expect(venueLabelsOf(extraction)).toEqual([]);
  });

  it('切り捨てられた応答は parse できても truncated で返す', () => {
    // 切り捨てられた JSON が運良く parse できても、中身は「途中まで」であり
    // 比較に使ってはいけない。
    const rec = record({
      stepId: 'detail-extraction',
      responseText: extractionResponse([{ name: '東京店' }]),
      responseTruncated: true,
    });

    expect(extractOccurrences(rec).status).toBe('truncated');
  });

  it('レコードが無い場合は absent で返す', () => {
    expect(extractOccurrences(undefined).status).toBe('absent');
  });

  it('occurrences が配列でなければ unparseable で返す', () => {
    const rec = record({
      stepId: 'detail-extraction',
      responseText: JSON.stringify({ event_data: { occurrences: '東京店' } }),
    });

    expect(extractOccurrences(rec).status).toBe('unparseable');
  });

  it('event_data が無い応答は ok の 0 件 (parse は成功しているため)', () => {
    const rec = record({ stepId: 'detail-extraction', responseText: '{"other":1}' });
    const extraction = extractOccurrences(rec);

    expect(extraction).toEqual({ status: 'ok', occurrences: [] });
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

  // ★ 照合不能な実行を「会場 0 件」として混ぜると、観測の欠損が
  //   「安定して全会場を落としている」= 系統的失敗に化ける。
  it('取り出せなかった実行を会場 0 件として混ぜず、判定から除外する', () => {
    const result = compareOccurrences([
      run('r1', [{ name: '東京店' }, { name: '大阪店' }], 'a'.repeat(64)),
      run('r2', [{ name: '東京店' }, { name: '大阪店' }], 'b'.repeat(64)),
      {
        label: 'r3',
        records: [
          record({
            stepId: 'detail-extraction',
            responseText: '{切り捨てられた JSON',
            responseSha256: 'c'.repeat(64),
          }),
        ],
      },
    ])!;

    // 両会場は「一部の実行にしか出ない」扱いにされない
    expect(result.evaluatedRunCount).toBe(2);
    expect(result.alwaysPresent).toEqual(['東京店', '大阪店']);
    expect(result.sometimesPresent).toEqual([]);
    // ただし取り出せなかった実行があるため「一致した」とも言わない
    expect(result.venueSetIdentical).toBe(false);
    expect(result.unevaluatedRuns).toHaveLength(1);
    expect(result.unevaluatedRuns[0].label).toBe('r3');
    expect(result.unevaluatedRuns[0].reason).toContain('照合不能');
  });

  it('どの実行からも取り出せなければ「判定不能」と表示し、不一致と言わない', () => {
    const runs: RunLog[] = [
      {
        label: 'r1',
        records: [
          record({ stepId: 'detail-extraction', responseText: 'x', responseTruncated: true }),
        ],
      },
    ];

    const result = compareOccurrences(runs)!;
    expect(result.evaluatedRunCount).toBe(0);
    expect(result.venueSetIdentical).toBe(false);

    // false を「不一致」と読ませない。表示は判定不能であること。
    const output = formatRunComparison(compareRuns(runs));
    expect(output).toContain('判定不能');
    expect(output).not.toContain('occurrences の会場集合: ⚠️ 不一致');
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
