/**
 * 会場の網羅性ゲート (S1-d Phase 3.8 Step A)。
 *
 * ## 何を守るのか
 *
 * `occurrences[]` は**同一入力でも確率的に落ちる**。`conan-cafe.jp` を同じ HTML で
 * 4 回流した実測は 10/8/10/8 件で、`promptSha256` も `resolvedModel` も同一だった
 * (= LLM の非決定性)。**出た会場は常に正しい**ので正確性の問題ではなく、
 * **網羅性**の問題である。
 *
 * 落ちた会場はそのまま MDX frontmatter に入り、後段 (Phase 4 の会場一覧テーブル) は
 * それを表に出す。放置すると**テーブルの行数が実行ごとに変わる**。
 *
 * 整合判定の道具 (`extractSourceTruth` / `compareWithSource`) は Step B / B-2 で
 * 完成しているが **CLI 専用**で、人間が `pnpm debug:verify` を叩かない限り
 * 不完全な出力を素通りさせる。本モジュールはそれをパイプライン本体へ昇格する。
 *
 * ## 設計の 3 原則
 *
 * 1. **測れないことを不合格にしない** (Phase 3.5 からの一貫方針)。正解データを
 *    作れないサイトは判定せず通す。ただし**必ず loud に記録する**
 * 2. **ゲートするのは `missingVenues` だけ**。`fabricatedVenues` /
 *    `periodMismatches` / `duplicateVenues` は記録するが停止させない。
 *    Phase 3.8 が扱うのは網羅性であり、正確性は実測で問題が出ていない
 * 3. **測れた上で欠落 → 止める** (fail-closed)。黙って不完全な記事を出さない
 *
 * ## ⚠️ やってはいけないこと
 *
 * **欠落した会場名を再試行のプロンプトへ注入しない。** 正解データを被測定側へ
 * 渡すとゲートが自己成就し、以後この指標は何も測らなくなる。再試行は
 * **同じ入力をもう一度引く**だけにとどめる (それで足りることは下記の実測が示す)。
 */

import {
  compareWithSource,
  extractSourceTruth,
  type SourceComparison,
  type SourceTruth,
} from '@/lib/utils/source-truth-extractor';
import { LLM_INPUT_BUDGET_CHARS } from '@/lib/utils/compact-html';
import {
  parseAndNormalizeEventData,
  type EventPeriodLike,
  type ParseAndNormalizeEventDataResult,
} from '@/lib/utils/event-data-normalization';

/**
 * 再抽出の上限。
 *
 * ## 根拠 (2026-08-14 の実測)
 *
 * `conan-cafe.jp` の同一入力 4 回のうち **2 回が 10/10 合格** (2026-08-12 のログ
 * `conan-cafe-jp-01..04` を空撃ちした結果 = ✅❌✅❌)。合格率 50% を独立と仮定すると
 * 3 回で全滅する確率は 0.5³ = **12.5%**。
 *
 * コストは `detail-extraction` 1 回 ≒ $0.03 で、**失敗した時だけ**発生する
 * (最悪 +$0.06/記事)。
 *
 * ⚠️ **系統的な欠落には効かない。** `sw2026` の圧縮前入力は 3 回とも同じ会場
 * (`Collabo_Index SHINSAIBASHI`) を落としており、回数を増やしても救えない。
 * ただし**打ち切らずに上限まで使う** — 確率的な欠落でも同じ会場が 2 回続くことが
 * 実測であったため、系統的かどうかは {@link resolveFailureKind} の事後分類で判定する。
 */
export const MAX_EXTRACTION_ATTEMPTS = 3;

/** 1 回の試行で観測した内容。観測ログと次試行の `recordContext` へ載せる。 */
export interface VenueGateAttempt {
  /** 1 始まり */
  attempt: number;
  /** `event_data` の parse 結果 */
  parseStatus: ParseAndNormalizeEventDataResult['status'];
  /** 正解データ側の会場数 (重複除去後) */
  expectedCount: number;
  /** 抽出側の会場数 (重複除去後) */
  actualUniqueCount: number;
  /** 🔴 ゲートの判定対象。非空なら不合格 */
  missingVenues: string[];
  /** 以下は記録のみ (ゲートしない) */
  fabricatedVenues: string[];
  periodMismatches: string[];
  duplicateVenues: string[];
  unmeasuredPeriodVenues: string[];
}

/** ゲートを通さなかった (通せなかった) 理由。`skipReason` の文面を分ける根拠になる。 */
export type VenueGateFailureKind =
  /**
   * `event_data` を読めないまま収束しなかった。
   *
   * 「キーが応答に無い (`absent`)」と「あるが `EventDataSchema` に不適合 (`invalid`)」の
   * 両方を含む。**どちらも会場が落ちたのではなく応答の形が違う**ので、対処先は
   * プロンプト / schema 側であり、`systematic` (= 抽出対象 HTML の是正) とは別。
   */
  | 'event-data-unreadable'
  /** LLM 入力が予算超過で切り詰められている。決定論的な欠落なので再試行しない */
  | 'input-truncated'
  /** 欠落した会場の集合が試行間で一致した = 系統的。再試行では直らない */
  | 'systematic'
  /** 上限まで試したが収束しなかった */
  | 'unconverged';

export type VenueGateVerdict =
  /** 会場が揃った */
  | { status: 'passed'; attempts: VenueGateAttempt[] }
  /**
   * 正解データを作れなかったので**判定していない**。記事は通す。
   *
   * ⚠️ 「合格」ではない。素通りさせた事実は必ずログに残すこと。
   */
  | { status: 'unmeasured'; reason: string; truthStatus: SourceTruth['status'] }
  /** 測れた上で会場が欠けている。記事を止める */
  | {
      status: 'failed';
      kind: VenueGateFailureKind;
      attempts: VenueGateAttempt[];
      /** 最後の試行で欠けていた会場 */
      missingVenues: string[];
      skipReason: string;
    };

export interface VenueCompletenessGateInput<TExtraction> {
  /**
   * 圧縮**前**のページ全体 HTML。
   *
   * 🔴 圧縮後を渡すと `SITE_PROFILES` の class セレクタが効かず、**どのサイトも
   * `unsupported` = ゲートが 1 度も発火しない**。しかも `unsupported` は
   * 「判定せず通す」ため loud にも停まらない。詳細は
   * `html-extractor.ts` の `ContentHtmlResult`。
   */
  rawHtml: string;
  /**
   * LLM へ実際に渡した入力 (圧縮後) の文字数。
   * `LLM_INPUT_BUDGET_CHARS` を超えていれば下流で切り詰められている。
   */
  llmInputChars: number;
  /**
   * 1 回の抽出を実行する。`previous` は直前の試行の観測 (初回は null)。
   *
   * 呼び出し側はこれを `recordContext` へ載せて観測ログに残す。
   * **プロンプトへ混ぜてはならない** (自己成就の防止)。
   */
  runAttempt: (
    attempt: number,
    previous: VenueGateAttempt | null,
    /** 実効的な上限。`maxAttempts` の上書きを呼び出し側のログへ正しく反映するため */
    maxAttempts: number
  ) => Promise<TExtraction>;
  /** 抽出結果から `event_data` を取り出す */
  getEventData: (extraction: TExtraction) => unknown;
  /** 抽出結果から `開催期間` を取り出す (`fallbackPeriod` の元) */
  getPeriod: (extraction: TExtraction) => EventPeriodLike | null | undefined;
  /** テスト用。既定は {@link MAX_EXTRACTION_ATTEMPTS} */
  maxAttempts?: number;
}

export interface VenueCompletenessGateResult<TExtraction> {
  /** 採用する抽出結果。**常に最後の試行**のもの */
  extraction: TExtraction;
  verdict: VenueGateVerdict;
}

/**
 * 抽出を実行し、会場の網羅性を判定する。
 *
 * `runAttempt` が throw した場合は**そのまま伝播させる** — 呼び出し側の既存の
 * catch が skip へ倒す (fail-closed)。ここで握り潰すと完全に無音になる。
 */
export async function runVenueCompletenessGate<TExtraction>(
  input: VenueCompletenessGateInput<TExtraction>
): Promise<VenueCompletenessGateResult<TExtraction>> {
  // ⚠️ 下限 1。0 以下を渡されるとループが 1 度も回らず `extraction` が未代入のまま
  //    返り、下流が undefined を掴む (definite assignment assertion が隠してしまう)。
  //    抽出はゲートの有無に関わらず必ず 1 回は必要なので、ここで担保する。
  const maxAttempts = Math.max(1, input.maxAttempts ?? MAX_EXTRACTION_ATTEMPTS);

  const measurability = assessMeasurability(input.rawHtml);
  if (!measurability.measurable) {
    return {
      extraction: await input.runAttempt(1, null, maxAttempts),
      verdict: {
        status: 'unmeasured',
        reason: measurability.reason,
        truthStatus: measurability.truthStatus,
      },
    };
  }

  const truth = measurability.truth;
  const inputTruncated = input.llmInputChars > LLM_INPUT_BUDGET_CHARS;

  const attempts: VenueGateAttempt[] = [];
  let extraction!: TExtraction;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    extraction = await input.runAttempt(attempt, attempts[attempts.length - 1] ?? null, maxAttempts);

    const parsed = parseAndNormalizeEventData({
      rawEventData: input.getEventData(extraction),
      period: input.getPeriod(extraction),
      // ⚠️ `prefectures` は detail-extraction 時点では未解決。`normalizeOccurrences` の
      //    warn にしか使われず**出力 occurrences には影響しない**ため、後段
      //    (lead-generation) の正規化結果と一致する。
    });

    // parse できなければ「抽出側の会場は 0 件」として照合する。正解に会場がある以上
    // 全件が `missingVenues` になり、fail-closed に倒れる (空配列へ潰していない —
    // 「測れなかった」ことは `parseStatus` で区別して skipReason の文面を分ける)。
    const comparison = compareWithSource(
      truth,
      parsed.status === 'ok' ? parsed.occurrences : []
    );

    attempts.push(toAttemptObservation(attempt, parsed.status, comparison));

    if (comparison.missingVenues.length === 0) {
      return { extraction, verdict: { status: 'passed', attempts } };
    }

    if (shouldStopEarly({ inputTruncated })) break;
  }

  return {
    extraction,
    verdict: buildFailure(resolveFailureKind({ attempts, inputTruncated }), attempts),
  };
}

type Measurability =
  | { measurable: true; truth: SourceTruth }
  | { measurable: false; reason: string; truthStatus: SourceTruth['status'] };

/**
 * 正解データを作れるかを判定する。作れないなら「判定せず通す」側へ倒す。
 *
 * ⚠️ **`expectedCount === 0` を `unsupported` と同列に扱うのが要点。**
 * `compareWithSource` は `venueLabel` が null の会場を読み飛ばすため、
 * ブロックセレクタだけ当たって会場名セレクタが当たらないサイトでは
 * 「supported / 0 会場」になる。この状態で `missingVenues` だけを見ると
 * **必ず空 = 素通り**する。「測れていない」側へ倒すこと。
 *
 * `expectedCount` は自前で数えず `compareWithSource(truth, [])` から取る。
 * 数え方 (重複除去・null 除外) を二重に実装すると、判定と照合がズレる。
 */
function assessMeasurability(rawHtml: string): Measurability {
  if (rawHtml.trim().length === 0) {
    return {
      measurable: false,
      reason: '照合用の HTML が空でした (取得に失敗したか、本文がレンダリングされていない)',
      truthStatus: 'unsupported',
    };
  }

  const truth = extractSourceTruth(rawHtml);
  if (truth.status === 'unsupported') {
    return {
      measurable: false,
      reason: truth.reason ?? '会場一覧の構造を認識できませんでした (profile 未対応)',
      truthStatus: truth.status,
    };
  }

  if (compareWithSource(truth, []).expectedCount === 0) {
    return {
      measurable: false,
      reason:
        `会場ブロックは認識できましたが (profile=${truth.profileId})、` +
        '会場名を 1 件も読めませんでした (venueSelector が未対応の可能性)',
      truthStatus: truth.status,
    };
  }

  return { measurable: true, truth };
}

function toAttemptObservation(
  attempt: number,
  parseStatus: ParseAndNormalizeEventDataResult['status'],
  comparison: SourceComparison
): VenueGateAttempt {
  return {
    attempt,
    parseStatus,
    expectedCount: comparison.expectedCount,
    actualUniqueCount: comparison.actualUniqueCount,
    missingVenues: comparison.missingVenues,
    fabricatedVenues: comparison.fabricatedVenues,
    periodMismatches: comparison.periodMismatches,
    duplicateVenues: comparison.duplicateVenues,
    unmeasuredPeriodVenues: comparison.unmeasuredPeriodVenues,
  };
}

/**
 * 上限に達する前に打ち切ってよいか。
 *
 * ## 打ち切るのは「入力切り詰め」だけ
 *
 * 切り詰めは**決定論的**な欠落で、同じ入力を引き直しても後半は永久に届かない。
 * 再試行はコストの純損失なので即座に止める。
 *
 * ## ⚠️ 「2 回続けて同じ会場が落ちたら系統的」で打ち切ってはいけない (2026-08-14 実測)
 *
 * 当初はそれで打ち切っていたが、`conan-cafe.jp` の実走 4 本で**誤判定を確認した**。
 *
 * | run | 試行ごとの欠落 | 結果 |
 * |---|---|---|
 * | 02 | `Cafe Fan Base` → `Cafe Fan Base` | 2 回目で打ち切り → **停止** |
 * | 04 | `Cafe Fan Base` → `キュープラザ原宿, ＫＩＴＴＥ OSAKA` → (なし) | **3 回目で合格** |
 *
 * 落ちやすい会場には偏りがあり (`Cafe Fan Base` が最頻)、**確率的な欠落でも同じ会場が
 * 2 回続く**。run 04 が示すとおり 3 回目で揃うことがあるため、2 回で打ち切ると
 * 救えた記事を止めてしまう。
 *
 * → **上限まで使う。** 系統的かどうかの判定は打ち切りではなく
 * {@link resolveFailureKind} の**事後分類**で行う (失敗時の追加コストは $0.03 のみ)。
 */
function shouldStopEarly(args: { inputTruncated: boolean }): boolean {
  return args.inputTruncated;
}

/**
 * 失敗の種別を決める。**根本原因の優先順で選ぶ。**
 *
 * 順序に意味がある:
 *
 * 1. `input-truncated` — 我々自身の入力が欠けているという**検証可能な事実**。
 *    他の症状より先に直すべきものなので最優先で名指しする
 * 2. `event-data-unreadable` — 全試行で `event_data` を読めなかった。会場が落ちたの
 *    ではなく**応答の形が違う**ので、対処先がプロンプト / schema 側になる
 * 3. `systematic` — **全試行が同じ会場集合を落とした**。再試行では直らないので、
 *    プロンプトか抽出対象 HTML の是正が要る
 * 4. `unconverged` — 欠落する会場が試行ごとに変わった (確率的) が収束しなかった
 *
 * ⚠️ `systematic` の判定を `event-data-unreadable` より後に置くのは、応答を読めないと
 * `missingVenues` が毎回「正解の全会場」= 同一集合になり、**wire format の問題が
 * 「系統的な会場欠落」に化けて原因を誤らせる**ため。
 *
 * ⚠️ **`absent` (キーが応答に無い) も `invalid` と同じ扱いにする** (claude[bot] 指摘、
 * 2026-08-14 採用)。`responseSchema` を適用しているのは `openai.provider.ts` だけで、
 * anthropic / gemini 経由では structured output が保証されないため
 * `event_data` キーごと欠落しうる。実挙動で `systematic` と誤診断されることを再現した。
 *
 * ⚠️ **`systematic` の判定には `parseStatus === 'ok'` の試行だけを使う** (claude[bot]
 * 2 巡目指摘、2026-08-14 採用)。応答を読めなかった試行は `occurrences: []` として
 * 照合するため `missingVenues` が「正解の全会場」になる。これを比較の母集団へ混ぜると、
 * **測れなかった試行を「同じ会場が落ち続けた」証拠として数えてしまう**。
 *
 * 実測した誤判定 (会場 1 件のページ / `absent, ok, ok`): 1 回目の wire format 事故を
 * 含めて `systematic` = 「プロンプトまたは抽出対象 HTML の是正が必要」と診断していた。
 * 加えて `absent, ok` の 2 試行では、**測れた試行が 1 つしかないのに**「落ち続けた」と
 * 結論しうる。系統的かどうかは 2 回以上**測れて初めて**言える。
 */
function resolveFailureKind(args: {
  attempts: VenueGateAttempt[];
  inputTruncated: boolean;
}): VenueGateFailureKind {
  if (args.inputTruncated) return 'input-truncated';
  if (args.attempts.every((a) => a.parseStatus !== 'ok')) return 'event-data-unreadable';

  const measured = args.attempts.filter((a) => a.parseStatus === 'ok');
  const [first, ...rest] = measured;
  if (rest.length > 0 && rest.every((a) => sameVenueSet(a.missingVenues, first.missingVenues))) {
    return 'systematic';
  }
  return 'unconverged';
}

/**
 * 2 つの会場名リストを**集合として**比較する。
 *
 * ⚠️ 素朴な「長さ一致 + 片方向の包含」では**重複要素に対して非対称**になる
 * (claude[bot] 4 巡目指摘、2026-08-14 採用)。実測:
 *
 * ```
 * a=[X,Y] b=[X,X] → true   ← 誤り (集合としては {X,Y} ≠ {X})
 * a=[X,X] b=[X,Y] → false  ← 引数を入れ替えると結果が変わる
 * ```
 *
 * 現状 `missingVenues` は `compareWithSource` が `expected` Map を走査して作るため
 * 一意だが、**それは別モジュールの不変条件への暗黙の依存**である。集合サイズを
 * 突き合わせて構造的に閉じる。
 */
function sameVenueSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...right].every((v) => left.has(v));
}

function buildFailure(
  kind: VenueGateFailureKind,
  attempts: VenueGateAttempt[]
): Extract<VenueGateVerdict, { status: 'failed' }> {
  const latest = attempts[attempts.length - 1];
  return {
    status: 'failed',
    kind,
    attempts,
    missingVenues: latest.missingVenues,
    skipReason: buildSkipReason(kind, attempts),
  };
}

/**
 * `skipReason` は**原因ごとに文面を変える**。
 *
 * 「3 回で収束せず」だけだと、schema 不適合・入力切り詰め・系統的欠落が同じ文面に
 * 潰れ、次に読む人が原因を誤る。`skipReason` の消費者は現状 `debug-mdx-url.ts` の
 * 表示のみ (機械判定している箇所は無い) ので、人が読んで原因に辿り着ける文面にする。
 */
function buildSkipReason(kind: VenueGateFailureKind, attempts: VenueGateAttempt[]): string {
  const latest = attempts[attempts.length - 1];
  const scale = `正解 ${latest.expectedCount} 会場中 ${latest.missingVenues.length} 件が欠落`;
  const names = latest.missingVenues.join(', ');
  const tries = `${attempts.length} 回試行`;

  switch (kind) {
    case 'event-data-unreadable': {
      // ★ 「キーが無い」と「形が違う」は対処が別。前者は wire format / プロンプト、
      //   後者は schema 定義を見る。同じ文面に潰すと次に読む人が原因を誤る。
      const cause = attempts.every((a) => a.parseStatus === 'absent')
        ? 'event_data キーが応答に存在しない'
        : attempts.every((a) => a.parseStatus === 'invalid')
          ? 'event_data が EventDataSchema に不適合'
          : 'event_data を読めない (キー欠落と schema 不適合が混在)';
      // ⚠️ **会場名を列挙しない** (claude[bot] 4 巡目指摘、2026-08-14 採用)。
      //    応答を読めなかった試行は occurrences 0 件として照合されるため
      //    `missingVenues` は必ず「正解の全会場」になる。それを並べると
      //    「特定の会場が抜けた」ように読め、真の原因 (wire format / schema) から
      //    目を逸らす。ここで要るのは会場名ではなく**応答が読めなかったという事実**。
      return (
        `会場情報を取得できませんでした: ${cause}まま${tries}。` +
        `正解データは ${latest.expectedCount} 会場を認識していますが、抽出結果を読めていません`
      );
    }
    case 'input-truncated':
      return (
        `会場情報が欠落しました: LLM 入力が ${LLM_INPUT_BUDGET_CHARS.toLocaleString()} 文字を超えて` +
        `切り詰められているため再試行しても回復しません。${scale} (${names})`
      );
    case 'systematic':
      return (
        `会場情報が系統的に欠落しました: ${tries}して同じ会場が落ち続けたため中止。` +
        `プロンプトまたは抽出対象 HTML の是正が必要です。${scale} (${names})`
      );
    case 'unconverged':
      return `会場情報が${tries}しても揃いませんでした。${scale} (${names})`;
  }
}
