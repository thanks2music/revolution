/**
 * AI Call Recorder — 全 AI ステップの入出力を構造化して 1 本の JSONL に残す。
 *
 * ## なぜ provider 層に置くか
 *
 * `AiProvider.sendMessage()` は **全 AI ステップが必ず通る唯一の地点**。8 つの
 * サービス (article-selection / rss-extraction / detail-extraction / subpage-detection /
 * metadata-generation / title-generation / lead-generation / content-generation) に
 * 個別実装すると「同じ手当てを一部にしか適用していない」状態を作る。実際、既存の
 * `DEBUG_*_PROMPT` フラグは 11 個に分裂し、**`DEBUG_EXTRACTION_PROMPT` だけが
 * 未設定**だったために「抽出ステップのプロンプトが 1 行も残らない」状態が続いた
 * (2026-08-11 の調査で 5 時間を空費した直接の原因)。
 *
 * ## 記録先の分割 (静的な入力はファイル / 可変な出力はレコード内)
 *
 * | 対象 | 置き場所 | 理由 |
 * |---|---|---|
 * | プロンプト全文 | `logs/prompts/{run}-{seq}-{step}.txt` | YAML テンプレート由来で巨大かつ実行間でほぼ不変。実測で **本体ログの 55% (1211/2196 行)** を占めていた |
 * | 応答全文 | JSONL レコード内 (`responseText`) | **実行ごとに変わる部分そのもの**。比較ツールが cross-file join なしで差分を取れる |
 *
 * プロンプトが実行間で変化したかは `promptSha256` で判定でき、変化していた場合だけ
 * 退避先ファイルを diff すればよい。
 *
 * ## 有効化条件
 *
 * | 条件 | 動作 |
 * |---|---|
 * | `initAiCallRecorder()` 済み (= `debug:mdx --log`) | **既定で記録**。`DEBUG_*` に依存しない |
 * | `DEBUG_AI_STEPS=all` | 未初期化でも記録 (遅延初期化) |
 * | `DEBUG_AI_STEPS=detail-extraction,title-generation` | 指定ステップのみ |
 * | `NODE_ENV === 'production'` | **無効**。Cloud Run は ephemeral FS で再起動時に消えるため書いても無意味 (`claude-vision.service.ts` の `saveLogToFile` と同じ判断) |
 *
 * @module lib/ai/observability/ai-call-recorder
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { PipelineStepId } from '@/lib/services/pipeline-steps';

/** 応答全文をレコードに埋め込む上限。超えた分は切り捨て、`responseTruncated` を立てる。 */
const MAX_INLINE_RESPONSE_CHARS = 200_000;

/**
 * 1 回の AI 呼び出しの記録。
 *
 * `compare-runs.ts` (Phase 3.5 D) と `verify-against-source.ts` (同 E) が本型を
 * 入力とするため、**フィールドの削除・改名は両スクリプトの破壊的変更**になる。
 */
export interface AiCallRecord {
  /** 実行の識別子。`debug:mdx --log` ではログファイルの basename と一致する */
  runId: string;
  /** 実行内の通し番号 (1 始まり)。同一ステップが複数回呼ばれても区別できる */
  seq: number;
  /** パイプラインステップ。`pipeline-steps.ts` の id。未指定呼び出しは `'unknown'` */
  stepId: PipelineStepId | 'unknown';
  /** 記録時刻 (ISO 8601) */
  ts: string;
  /** `'openai' | 'anthropic' | 'gemini'` */
  provider: string;

  /** こちらが要求したモデル名 */
  requestedModel: string;
  /**
   * API が応答で返した実モデル名 (例: `gpt-5.4-mini-2026-01-30`)。
   *
   * 要求名は日付なしの alias であることが多く、**alias の解決先が変わっても
   * 要求名だけ見ていると気づけない**。要求と応答を並べて初めて分かる。
   *
   * 実測 (2026-08-11) では `gpt-5.4-mini` → `gpt-5.4-mini-2026-03-17` が返った。
   * `systemFingerprint` が供給されない現状、**モデル基盤の変化を捉える実質的な
   * 手段はこのフィールド**。
   */
  resolvedModel?: string;
  /**
   * OpenAI の `system_fingerprint`。Anthropic / Gemini は同等の概念を持たず `null`。
   *
   * ⚠️ **実測 (2026-08-11、`gpt-5.4-mini` / 7 レコード) では OpenAI 自身が返さず
   * 全件 null だった。** モデル基盤の変化を実際に捉えられるのは
   * {@link AiCallRecord.resolvedModel} のほう。詳細は
   * `ai-provider.interface.ts` の同名フィールドの JSDoc を参照。
   */
  systemFingerprint?: string | null;
  /** OpenAI `finish_reason` / Anthropic `stop_reason`。`length` なら出力が切れている */
  finishReason?: string;
  /** API 呼び出しの所要時間 (ms)。失敗時も計測する */
  latencyMs: number;
  /** OpenAI `completion.id` 等。サポートへの問い合わせに使う */
  requestId?: string;
  /** 送信した temperature。非決定性の議論に必要 */
  temperature?: number;

  /** プロンプト全文の SHA-256。**同一入力かの判定はこの 1 フィールドの比較で済む** */
  promptSha256: string;
  promptChars: number;
  /** プロンプト全文の退避先 (リポジトリルートからの相対パス) */
  promptFile?: string;

  /** 応答全文の SHA-256 */
  responseSha256?: string;
  responseChars?: number;
  /** 応答全文。比較ツールが直接 parse する */
  responseText?: string;
  /** `MAX_INLINE_RESPONSE_CHARS` を超えて切り捨てた場合に true */
  responseTruncated?: boolean;

  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** 呼び出しが throw した場合のメッセージ。**成功記録と同じ平面に残す** */
  error?: string;

  /**
   * ステップ固有の付随情報。
   *
   * `detail-extraction` では `{ usedUrl, candidateUrls, unusedUrls, inputHtmlBytes,
   * inputHtmlSha256 }` が入る (Phase 3.5 F)。「どの URL が抽出に使われたか」が
   * 候補一覧とともに 1 レコードに収まる。
   */
  context?: Record<string, unknown>;
}

/** `recordAiCall` の入力。`runId` / `seq` / `ts` / `promptFile` は recorder が埋める。 */
export type AiCallRecordInput = Omit<AiCallRecord, 'runId' | 'seq' | 'ts' | 'promptFile'> & {
  /** プロンプト全文。ファイルへ退避され、レコードには sha と文字数だけが残る */
  prompt: string;
};

interface RecorderState {
  runId: string;
  jsonlPath: string;
  promptsDir: string;
  seq: number;
  /** 書き込みを直列化する promise チェーン。Vision API 等の並列呼び出しで行が混ざるのを防ぐ */
  writeChain: Promise<void>;
}

let state: RecorderState | null = null;
/** `initAiCallRecorder` が明示的に呼ばれたか。DEBUG_AI_STEPS による遅延初期化と区別する */
let explicitlyInitialized = false;

/** `NODE_ENV === 'production'` では常に無効。 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * `DEBUG_AI_STEPS` を解釈する。
 *
 * - 未設定 → `null` (フラグによる有効化なし)
 * - `all` / `true` / `1` → 全ステップ
 * - `detail-extraction,title-generation` → 指定ステップのみ
 */
function parseDebugAiSteps(): 'all' | Set<string> | null {
  const raw = process.env.DEBUG_AI_STEPS?.trim();
  if (!raw) return null;
  if (raw === 'all' || raw === 'true' || raw === '1') return 'all';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

/**
 * 記録が有効かを判定する。
 *
 * 明示初期化 (= `debug:mdx --log`) されていれば **`DEBUG_AI_STEPS` の有無に関わらず
 * 全ステップを記録する**。これがフラグ設定漏れを構造的に潰す部分。
 */
export function isAiCallRecordingEnabled(stepId: PipelineStepId | 'unknown'): boolean {
  if (isProduction()) return false;
  if (explicitlyInitialized) return true;

  const flag = parseDebugAiSteps();
  if (flag === null) return false;
  if (flag === 'all') return true;
  return flag.has(stepId);
}

/**
 * ログファイルのパスから recorder を初期化する。
 *
 * `debug-mdx-url.ts` が `--log` 指定時に呼ぶ。JSONL は `.log` と **同じ basename**
 * に揃えるため、`logs/2026-08-12-sw2026-03.log` に対して
 * `logs/2026-08-12-sw2026-03.jsonl` が並ぶ。
 *
 * @param logFilePath 本体ログのパス (絶対パス)
 */
export function initAiCallRecorder(logFilePath: string): void {
  if (isProduction()) return;

  const dir = path.dirname(logFilePath);
  const runId = path.basename(logFilePath, path.extname(logFilePath));

  state = {
    runId,
    jsonlPath: path.join(dir, `${runId}.jsonl`),
    promptsDir: path.join(dir, 'prompts'),
    seq: 0,
    writeChain: Promise.resolve(),
  };
  explicitlyInitialized = true;
}

/**
 * `DEBUG_AI_STEPS` だけが指定された経路 (API Route 等) 用の遅延初期化。
 *
 * `debug:mdx` を経由しないため basename の元になるログファイルが無い。日付 + PID で
 * 一意な runId を作る。
 */
function ensureLazyState(): RecorderState {
  if (state) return state;

  const logsDir = path.resolve(process.cwd(), 'logs');
  const date = new Date().toISOString().split('T')[0];
  const runId = `${date}-ai-calls-${process.pid}`;

  state = {
    runId,
    jsonlPath: path.join(logsDir, `${runId}.jsonl`),
    promptsDir: path.join(logsDir, 'prompts'),
    seq: 0,
    writeChain: Promise.resolve(),
  };
  return state;
}

/** 現在の runId。未初期化なら undefined。 */
export function getAiCallRunId(): string | undefined {
  return state?.runId;
}

/** JSONL の出力先。完了報告でユーザーへ提示するために使う。 */
export function getAiCallJsonlPath(): string | undefined {
  return state?.jsonlPath;
}

/**
 * テスト用に内部状態を捨てる。プロダクションコードからは呼ばない。
 */
export function resetAiCallRecorderForTest(): void {
  state = null;
  explicitlyInitialized = false;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** ファイル名に使えない文字を落とす。 */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * ログに載せるパス表記。
 *
 * cwd 配下なら相対パスのほうが読みやすいが、外に出る場合 (テストの一時ディレクトリ等)
 * は `../../../..` が延々と続いて可読性を損なうため絶対パスへ倒す。
 */
function displayPath(absolutePath: string): string {
  const rel = path.relative(process.cwd(), absolutePath);
  return rel.startsWith('..') ? absolutePath : rel;
}

/**
 * 1 回の AI 呼び出しを記録する。
 *
 * **この関数は決して throw しない。** 観測のための処理がパイプラインを止めるのは
 * 本末転倒であり、記録の失敗は warn に留めて呼び出し元へ伝播させない。
 */
export async function recordAiCall(input: AiCallRecordInput): Promise<void> {
  if (!isAiCallRecordingEnabled(input.stepId)) return;

  try {
    const s = ensureLazyState();
    const seq = ++s.seq;
    const seqLabel = String(seq).padStart(2, '0');

    const { prompt, responseText, ...rest } = input;

    // プロンプト全文を退避。本体ログにはポインタ 1 行だけを出す (呼び出し元が出力)。
    const promptFileName = `${s.runId}-${seqLabel}-${safeSegment(input.stepId)}.txt`;
    const promptFilePath = path.join(s.promptsDir, promptFileName);

    const truncated =
      responseText !== undefined && responseText.length > MAX_INLINE_RESPONSE_CHARS;

    const record: AiCallRecord = {
      ...rest,
      runId: s.runId,
      seq,
      ts: new Date().toISOString(),
      promptFile: displayPath(promptFilePath),
      responseText: truncated
        ? responseText!.slice(0, MAX_INLINE_RESPONSE_CHARS)
        : responseText,
      ...(truncated ? { responseTruncated: true } : {}),
    };

    // 書き込みを直列化する。Vision API のように並列で走る経路があるため、
    // appendFile を素で並べると 1 行の途中で別の行が割り込みうる。
    s.writeChain = s.writeChain
      .then(async () => {
        await fs.mkdir(s.promptsDir, { recursive: true });
        await fs.writeFile(promptFilePath, prompt, 'utf-8');
        await fs.mkdir(path.dirname(s.jsonlPath), { recursive: true });
        await fs.appendFile(s.jsonlPath, JSON.stringify(record) + '\n', 'utf-8');
      })
      .catch((error) => {
        console.warn('[AiCallRecorder] 記録に失敗 (処理は続行):', error);
      });

    await s.writeChain;

    // 本体ログにはポインタ 1 行だけを出す。全文はファイル側にある。
    console.log(
      formatPromptPointer({
        stepId: input.stepId,
        prompt,
        promptFile: record.promptFile,
      })
    );
  } catch (error) {
    console.warn('[AiCallRecorder] 記録に失敗 (処理は続行):', error);
  }
}

/**
 * 本体ログへのプロンプト全文出力を抑止してよいか。
 *
 * 既存の `DEBUG_SELECTION_PROMPT` / `DEBUG_EXTRACTION_PROMPT` / `DEBUG_TITLE_PROMPT` /
 * `DEBUG_CONTENT_PROMPT` は全文を本体ログへ流し込む。実測ではこれが
 * **ログ 2196 行のうち 1211 行 (55%)** を占め、実出力がテンプレ由来の文字列に
 * 埋もれていた。
 *
 * recorder が有効なら同じ内容が `logs/prompts/` に残っているため、本体ログ側は
 * 抑止してよい。**情報は失われず、置き場所が変わるだけ**。フラグを OFF にするよう
 * 促す必要もない (`.env.local` は直接編集できない前提のため、この判定が要る)。
 */
export function shouldSuppressInlinePromptDump(
  stepId: PipelineStepId | 'unknown'
): boolean {
  return isAiCallRecordingEnabled(stepId);
}

/**
 * 呼び出し元が本体ログへ出す 1 行を組み立てる。
 *
 * プロンプト全文の代わりにこの 1 行だけが本体ログに載る。
 */
export function formatPromptPointer(params: {
  stepId: PipelineStepId | 'unknown';
  prompt: string;
  promptFile?: string;
}): string {
  const chars = params.prompt.length.toLocaleString();
  const hash = sha256(params.prompt).slice(0, 12);
  const where = params.promptFile ? ` → ${params.promptFile}` : '';
  return `[${params.stepId}] prompt${where} (${chars} chars, sha256 ${hash})`;
}

/** プロンプト / 応答のハッシュ計算を呼び出し元へ公開する。 */
export { sha256 as hashForAiCallRecord };
