/**
 * 会場の網羅性ゲート (S1-d Phase 3.8 Step A) の Layer 1 テスト。
 *
 * fixture はインラインに置く。`debug-logs/` `logs/` は gitignored で CI から読めない
 * (`html-extractor.test.ts` の既存判断と同じ)。
 */

import { compactHtmlForLlm } from '@/lib/utils/compact-html';
import { extractSourceTruth } from '@/lib/utils/source-truth-extractor';
import {
  MAX_EXTRACTION_ATTEMPTS,
  runVenueCompletenessGate,
  type VenueGateVerdict,
} from '@/lib/utils/venue-completeness-gate';

/** 会場 2 件を持つ ltr 系ページ (`.place` = class セレクタ)。 */
const TWO_VENUE_PAGE = `
<!DOCTYPE html><html><head><title>テストカフェ</title></head>
<body>
  <div class="info-container">
    <div class="place">
      <h2>TOKYO</h2>
      <p class="place_text_01">BOX cafe&amp;space 渋谷店</p>
      <p class="place_text_02"><span>【開催期間】</span> 2026年5月14日(木)〜2026年7月5日(日)</p>
    </div>
    <div class="place">
      <h2>OSAKA</h2>
      <p class="place_text_01">BOX cafe&amp;space 大阪店</p>
      <p class="place_text_02"><span>【開催期間】</span> 2026年5月28日(木)〜2026年6月28日(日)</p>
    </div>
  </div>
</body></html>`;

/** 会場一覧を持たないページ。正解データを作れないので `unsupported`。 */
const NO_VENUE_PAGE = `
<!DOCTYPE html><html><head><title>TOKYO INFORMATION</title></head>
<body><div class="wrap"><h1>開催情報</h1><p>開催期間 2026年5月14日〜7月5日</p></div></body></html>`;

/**
 * ブロックは `.place` で当たるが**会場名 (`.place_text_01`) が無い**ページ。
 *
 * `compareWithSource` は `venueLabel` が null の会場を読み飛ばすため
 * 「supported / 0 会場」になる。`missingVenues` だけを見ると必ず空になり素通りする。
 */
const VENUE_BLOCK_WITHOUT_NAMES = `
<!DOCTYPE html><html><body>
  <div class="place">
    <h2>TOKYO</h2>
    <p class="other">2026年5月14日(木)〜2026年7月5日(日)</p>
  </div>
</body></html>`;

const OCCURRENCE_SHIBUYA = {
  venue_slug: null,
  venue_label: 'BOX cafe&space 渋谷店',
  starts_on: '2026-05-14',
  ends_on: '2026-07-05',
  official_url: null,
};
const OCCURRENCE_OSAKA = {
  venue_slug: null,
  venue_label: 'BOX cafe&space 大阪店',
  starts_on: '2026-05-28',
  ends_on: '2026-06-28',
  official_url: null,
};

const PERIOD = {
  開始: { 年: '2026年', 日付: '5月14日' },
  終了: { 年: '2026年', 日付: '7月5日', 未定: false },
};

/** `event_data` を組み立てる。`primary_category_slug` と `title_slugs` は schema 必須。 */
function eventData(occurrences: unknown[]): Record<string, unknown> {
  return { primary_category_slug: 'collabo-cafe', title_slugs: ['test-work'], occurrences };
}

interface FakeExtraction {
  event_data: unknown;
  開催期間: typeof PERIOD;
}

/**
 * 抽出結果の列を順に返す `runAttempt` を作る。呼び出し回数も数える。
 * 列が尽きたら最後の要素を返し続ける。
 */
function stubAttempts(results: unknown[]): {
  runAttempt: (attempt: number) => Promise<FakeExtraction>;
  calls: () => number;
} {
  let calls = 0;
  return {
    runAttempt: async (attempt) => {
      calls++;
      return {
        event_data: results[Math.min(attempt - 1, results.length - 1)],
        開催期間: PERIOD,
      };
    },
    calls: () => calls,
  };
}

function runGate(
  rawHtml: string,
  results: unknown[],
  options: { llmInputChars?: number; maxAttempts?: number } = {}
): Promise<{ verdict: VenueGateVerdict; calls: number }> {
  const stub = stubAttempts(results);
  return runVenueCompletenessGate<FakeExtraction>({
    rawHtml,
    llmInputChars: options.llmInputChars ?? 1_000,
    runAttempt: stub.runAttempt,
    getEventData: (e) => e.event_data,
    getPeriod: (e) => e.開催期間,
    maxAttempts: options.maxAttempts,
  }).then((r) => ({ verdict: r.verdict, calls: stub.calls() }));
}

describe('runVenueCompletenessGate', () => {
  it('会場が揃っていれば 1 回で通す', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([OCCURRENCE_SHIBUYA, OCCURRENCE_OSAKA]),
    ]);

    expect(verdict.status).toBe('passed');
    expect(calls).toBe(1);
  });

  it('2 回目で揃えば 2 回で止める (上限まで回さない)', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([OCCURRENCE_SHIBUYA]), // 1 回目: 大阪が欠落
      eventData([OCCURRENCE_SHIBUYA, OCCURRENCE_OSAKA]), // 2 回目: 揃った
    ]);

    expect(verdict.status).toBe('passed');
    expect(calls).toBe(2);
    if (verdict.status !== 'passed') throw new Error('unreachable');
    expect(verdict.attempts).toHaveLength(2);
    expect(verdict.attempts[0].missingVenues).toEqual(['BOX cafe&space 大阪店']);
    expect(verdict.attempts[1].missingVenues).toEqual([]);
  });

  // ★ 欠落する会場が毎回変わる = 確率的。実測 (conan-cafe.jp) がこの形。
  //   上限まで試したうえで停止する。
  it('欠落会場が試行ごとに変わる場合は上限まで試して停止する', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([OCCURRENCE_SHIBUYA]), // 大阪が欠落
      eventData([OCCURRENCE_OSAKA]), // 渋谷が欠落 (別の集合)
      eventData([OCCURRENCE_SHIBUYA]), // 再び大阪が欠落
    ]);

    expect(calls).toBe(MAX_EXTRACTION_ATTEMPTS);
    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('unconverged');
    expect(verdict.skipReason).toContain('3 回試行');
  });

  // ★ 全試行が同じ会場集合を落とした = 系統的。実測 (sw2026 の圧縮前入力) がこの形で
  //   3 回とも同じ会場を落とした。
  //
  //   ⚠️ **上限まで使い切ってから分類する。** 2 回続けて同一で打ち切ると、
  //   conan-cafe.jp の実走 run 04 (Cafe Fan Base → 別の 2 件 → 合格) のように
  //   3 回目で救えるケースを止めてしまう (2026-08-14 実測で誤判定を確認)。
  it('全試行が同じ会場集合を落としたら系統的と分類する (打ち切りはしない)', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([OCCURRENCE_SHIBUYA]), // 毎回同じ会場が落ちる
    ]);

    expect(calls).toBe(MAX_EXTRACTION_ATTEMPTS); // 上限まで試す
    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('systematic');
    expect(verdict.missingVenues).toEqual(['BOX cafe&space 大阪店']);
  });

  // ★ 実走 run 04 の再現。2 回目まで欠落しても 3 回目で揃うことがある。
  it('2 回目まで欠落しても 3 回目で揃えば合格にする', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([OCCURRENCE_SHIBUYA]), // 大阪が欠落
      eventData([OCCURRENCE_SHIBUYA]), // また大阪が欠落 (同じ集合)
      eventData([OCCURRENCE_SHIBUYA, OCCURRENCE_OSAKA]), // 3 回目で揃った
    ]);

    expect(calls).toBe(3);
    expect(verdict.status).toBe('passed');
  });

  // ★ 切り詰めは決定論的な欠落。同じ入力を引き直しても後半は届かないので、
  //   コストを払って再試行しない。
  it('LLM 入力が予算超過なら再試行せず即停止する', async () => {
    const { verdict, calls } = await runGate(
      TWO_VENUE_PAGE,
      [eventData([OCCURRENCE_SHIBUYA])],
      { llmInputChars: 10_000_000 }
    );

    expect(calls).toBe(1);
    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('input-truncated');
    expect(verdict.skipReason).toContain('切り詰められている');
  });

  it('event_data が schema 不適合のまま収束しなければ原因を書き分ける', async () => {
    // `primary_category_slug` / `title_slugs` (schema 必須) を欠いた不正な形
    const { verdict } = await runGate(TWO_VENUE_PAGE, [{ occurrences: [] }]);

    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('event-data-unreadable');
    expect(verdict.skipReason).toContain('EventDataSchema に不適合');
    expect(verdict.attempts.every((a) => a.parseStatus === 'invalid')).toBe(true);
  });

  // ★ claude[bot] 指摘 (2026-08-14 採用)。`responseSchema` を適用しているのは
  //   `openai.provider.ts` だけで、anthropic / gemini 経由では structured output が
  //   保証されず `event_data` キーごと欠落しうる。このとき missingVenues は毎回
  //   「正解の全会場」= 同一集合になるため、対策前は `systematic` と誤診断され
  //   「プロンプトまたは抽出対象 HTML の是正が必要」と**誤った対処先**を指していた。
  it('event_data キーが応答に無い場合も schema 不適合と同じ種別にし、原因を書き分ける', async () => {
    const { verdict } = await runGate(TWO_VENUE_PAGE, [undefined]);

    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('event-data-unreadable');
    expect(verdict.kind).not.toBe('systematic');
    expect(verdict.skipReason).toContain('event_data キーが応答に存在しない');
    expect(verdict.attempts.every((a) => a.parseStatus === 'absent')).toBe(true);
  });

  it('キー欠落と schema 不適合が混在する場合はその旨を出す', async () => {
    const { verdict } = await runGate(TWO_VENUE_PAGE, [
      undefined, // キー欠落
      { occurrences: [] }, // schema 不適合
      undefined,
    ]);

    expect(verdict.status).toBe('failed');
    if (verdict.status !== 'failed') throw new Error('unreachable');
    expect(verdict.kind).toBe('event-data-unreadable');
    expect(verdict.skipReason).toContain('キー欠落と schema 不適合が混在');
  });

  describe('測れない場合は判定せず通す (Phase 3.5 からの一貫方針)', () => {
    it('正解データが unsupported なら 1 回で通す', async () => {
      const { verdict, calls } = await runGate(NO_VENUE_PAGE, [eventData([])]);

      expect(calls).toBe(1);
      expect(verdict.status).toBe('unmeasured');
      if (verdict.status !== 'unmeasured') throw new Error('unreachable');
      expect(verdict.truthStatus).toBe('unsupported');
      expect(verdict.reason).toBeTruthy();
    });

    // 🔴 これが無いと「supported / 0 会場」で missingVenues が必ず空になり、
    //    ゲートが素通りする (合格と区別できない)。
    it('ブロックは当たるが会場名が読めない場合も「測れていない」側へ倒す', async () => {
      // 前提: 正解データ自体は supported になっている (unsupported 経路ではない)
      expect(extractSourceTruth(VENUE_BLOCK_WITHOUT_NAMES).status).toBe('supported');

      const { verdict } = await runGate(VENUE_BLOCK_WITHOUT_NAMES, [eventData([])]);

      expect(verdict.status).toBe('unmeasured');
      if (verdict.status !== 'unmeasured') throw new Error('unreachable');
      expect(verdict.truthStatus).toBe('supported');
      expect(verdict.reason).toContain('会場名を 1 件も読めませんでした');
    });

    it('照合用 HTML が空なら通す (unsupported と理由を書き分ける)', async () => {
      const { verdict } = await runGate('   ', [eventData([])]);

      expect(verdict.status).toBe('unmeasured');
      if (verdict.status !== 'unmeasured') throw new Error('unreachable');
      expect(verdict.reason).toContain('HTML が空');
    });
  });

  // ★ 抽出はゲートの有無に関わらず必ず 1 回は必要。0 以下でループが回らないと
  //   `extraction` が未代入で返り、下流が undefined を掴む。
  it('maxAttempts が 0 以下でも 1 回は抽出する', async () => {
    const { verdict, calls } = await runGate(
      TWO_VENUE_PAGE,
      [eventData([OCCURRENCE_SHIBUYA, OCCURRENCE_OSAKA])],
      { maxAttempts: 0 }
    );

    expect(calls).toBe(1);
    expect(verdict.status).toBe('passed');
  });

  it('抽出が throw したらそのまま伝播させる (握り潰して無音にしない)', async () => {
    await expect(
      runVenueCompletenessGate<FakeExtraction>({
        rawHtml: TWO_VENUE_PAGE,
        llmInputChars: 1_000,
        runAttempt: () => Promise.reject(new Error('AI API error')),
        getEventData: (e) => e.event_data,
        getPeriod: (e) => e.開催期間,
      })
    ).rejects.toThrow('AI API error');
  });

  // ★ Phase 3.8 が扱うのは**網羅性**。正確性 (期間の不一致・捏造・重複) は
  //   記録するが停止させない。実測でも `kusuriya-03` は期間不一致のみで会場は 2/2。
  it('期間の不一致・正解に無い会場・重複ではゲートしない (記録はする)', async () => {
    const { verdict, calls } = await runGate(TWO_VENUE_PAGE, [
      eventData([
        { ...OCCURRENCE_SHIBUYA, ends_on: '2026-12-31' }, // 期間が違う
        OCCURRENCE_OSAKA,
        { ...OCCURRENCE_OSAKA, starts_on: '2026-01-01' }, // 同じ会場を別期間で 2 回
        { ...OCCURRENCE_SHIBUYA, venue_label: '架空カフェ' }, // 正解に無い会場
      ]),
    ]);

    expect(calls).toBe(1);
    expect(verdict.status).toBe('passed');
    if (verdict.status !== 'passed') throw new Error('unreachable');

    const attempt = verdict.attempts[0];
    expect(attempt.missingVenues).toEqual([]);
    // 停止させないが、観測はしている
    expect(attempt.periodMismatches).toContain('BOX cafe&space 渋谷店');
    expect(attempt.fabricatedVenues).toContain('架空カフェ');
    expect(attempt.duplicateVenues).toContain('BOX cafe&space 大阪店');
  });

  it('前回の観測を runAttempt へ渡す (recordContext へ載せるため)', async () => {
    const seen: (number | null)[] = [];
    await runVenueCompletenessGate<FakeExtraction>({
      rawHtml: TWO_VENUE_PAGE,
      llmInputChars: 1_000,
      runAttempt: async (attempt, previous) => {
        seen.push(previous?.missingVenues.length ?? null);
        return {
          event_data:
            attempt === 1
              ? eventData([OCCURRENCE_SHIBUYA])
              : eventData([OCCURRENCE_SHIBUYA, OCCURRENCE_OSAKA]),
          開催期間: PERIOD,
        };
      },
      getEventData: (e) => e.event_data,
      getPeriod: (e) => e.開催期間,
    });

    // 1 回目は null、2 回目は前回の欠落件数 (1) が渡る
    expect(seen).toEqual([null, 1]);
  });
});

/**
 * 🔴 ゲートの生命線。**圧縮後 HTML を照合へ渡すとゲートが黙って無効化される**ことを
 * 対で固定する。`compact-html.ts` の `KEEP_ATTRIBUTES` を将来誰かが触ったとき
 * (あるいは「raw を渡す」配線を戻したとき) ここが落ちる。
 */
describe('圧縮前 HTML を渡さないとゲートが機能しない (不変条件)', () => {
  it('圧縮は class 属性を落とすため、圧縮後は unsupported になる', () => {
    const compacted = compactHtmlForLlm(TWO_VENUE_PAGE).html;

    expect(compacted).not.toContain('class=');
    expect(extractSourceTruth(compacted).status).toBe('unsupported');
  });

  it('圧縮前なら supported で会場を読める', () => {
    const truth = extractSourceTruth(TWO_VENUE_PAGE);

    expect(truth.status).toBe('supported');
    expect(truth.profileId).toBe('ltr');
    expect(truth.venues).toHaveLength(2);
  });

  // ★ 「unsupported は判定せず通す」設計と組み合わさると、圧縮後を渡した場合に
  //   **ゲートが 1 度も発火しないまま loud にも停まらない**。それを実演する。
  it('圧縮後を渡すと会場が全部落ちていても通ってしまう', async () => {
    const compacted = compactHtmlForLlm(TWO_VENUE_PAGE).html;
    const { verdict } = await runGate(compacted, [eventData([])]);

    expect(verdict.status).toBe('unmeasured');

    // 同じ入力 (会場 0 件) を圧縮前 HTML で照合すれば、ちゃんと止まる
    const withRaw = await runGate(TWO_VENUE_PAGE, [eventData([])]);
    expect(withRaw.verdict.status).toBe('failed');
  });
});
