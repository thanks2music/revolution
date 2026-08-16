/**
 * Gemini 応答の読み取りと異常系の検出
 *
 * `gemini.provider.ts` (生成) と `gemini-vision.service.ts` (Vision) が共有する。
 * 両者で同じ判定を二重実装すると、片方だけ異常系を取りこぼす形になるため 1 箇所に集約する。
 *
 * @module lib/ai/gemini-response
 */

import type { GenerateContentResponse } from '@google/genai';

/**
 * 応答が `maxOutputTokens` に達して切り詰められた
 *
 * 🔴 **設定起因の決定論的な失敗**なので、呼び出し側はリトライしてはならない。
 * 同じ `maxOutputTokens` / `thinkingLevel` で投げ直しても再現する可能性が高く、
 * バックオフを挟むぶんコストとレイテンシを浪費するだけになる
 * (Zod の形状違反と同じ扱いにする)。
 */
export class GeminiTruncatedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiTruncatedResponseError';
  }
}

/**
 * 応答が `STOP` 以外の理由で打ち切られた (SAFETY / RECITATION / PROHIBITED_CONTENT 等)
 *
 * これらの場合 `response.text` は undefined になりうる。空文字列を「正常な結果」として
 * 下流へ流すと、slug が空になったり Vision の抽出が空配列になったりして、
 * **原因から離れた場所で症状だけが出る**。ここで loud に停める。
 */
export class GeminiBlockedResponseError extends Error {
  constructor(
    message: string,
    /** API が返した `finishReason` (例: `SAFETY`) */
    readonly finishReason: string
  ) {
    super(message);
    this.name = 'GeminiBlockedResponseError';
  }
}

/**
 * 「リトライしても無駄な決定論的失敗」かを判定する
 *
 * 切り詰めは `maxOutputTokens` / `thinkingLevel` という**固定設定**、
 * ブロックは**入力そのもの**に起因するため、どちらも同じ条件で投げ直せば再現する。
 *
 * 🔴 **呼び出し側は catch でこの型を潰さないこと。** 汎用の `Error` にラップして
 * 投げ直すと `instanceof` の情報が失われ、上流でリトライ可否を判断できなくなる
 * (Vision 側 `gemini-vision.service.ts` はこの型でリトライを止めている)。
 */
export function isGeminiDeterministicError(error: unknown): boolean {
  return (
    error instanceof GeminiTruncatedResponseError || error instanceof GeminiBlockedResponseError
  );
}

/** 正常終了とみなす `finishReason`。`undefined` は「未報告」なので許容する */
const OK_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_STOP']);

export interface ReadGeminiTextContext {
  /** ログ・エラーメッセージに出す呼び出し元の識別子 (例: `GeminiProvider`) */
  label: string;
  /** 実際に呼んだモデル名 */
  modelName: string;
  /** 適用した thinking レベル */
  thinkingLevel: string;
  /** 切り詰め時に案内する env 名 (例: `AI_THINKING_LEVEL`) */
  thinkingEnvName: string;
}

/**
 * 応答本文を取り出す。**異常終了した応答を正常な結果として返さない**
 *
 * 🔴 Gemini は上限到達やコンテンツブロックでも例外を投げず、`finishReason` と
 * (あれば) 途中までの文字列を返す。実測 (2026-08-16、`gemini-3.6-flash`、
 * `maxTokens: 100` + thinking LOW) では slug が `kusuriya-no-hitorigoto` ではなく
 * `kusuriya-` になり、そのままなら壊れた slug が記事 URL になっていた。
 *
 * @throws {GeminiTruncatedResponseError} `finishReason` が `MAX_TOKENS` のとき
 * @throws {GeminiBlockedResponseError} `finishReason` が `STOP` 以外のその他のとき
 */
export function readGeminiText(
  response: GenerateContentResponse,
  ctx: ReadGeminiTextContext
): string {
  const finishReason = response.candidates?.[0]?.finishReason;
  const usage = response.usageMetadata;
  const where = `model=${ctx.modelName} thinking=${ctx.thinkingLevel}`;

  if (finishReason === 'MAX_TOKENS') {
    throw new GeminiTruncatedResponseError(
      `[${ctx.label}] Gemini response was truncated (finishReason=MAX_TOKENS). ${where} ` +
        `thoughtsTokens=${usage?.thoughtsTokenCount ?? 0} ` +
        `outputTokens=${usage?.candidatesTokenCount ?? 0}. ` +
        `Gemini counts thinking tokens against maxOutputTokens — lower ${ctx.thinkingEnvName} ` +
        `or raise the caller's maxTokens.`
    );
  }

  if (finishReason && !OK_FINISH_REASONS.has(finishReason)) {
    throw new GeminiBlockedResponseError(
      `[${ctx.label}] Gemini stopped with finishReason=${finishReason} (not STOP). ${where}. ` +
        `The response body is unreliable and is not passed downstream.`,
      finishReason
    );
  }

  return response.text ?? '';
}
