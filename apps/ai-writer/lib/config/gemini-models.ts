/**
 * Google Gemini Model Definitions and Call-Configuration Normalizers
 *
 * Purpose:
 *   - Centralized model name constants (mirrors `lib/config/claude-models.ts`)
 *   - Single source of truth for Gemini model versions
 *   - Normalize env strings into the SDK enums used by both the text provider
 *     and the Vision service
 *
 * なぜ 1 ファイルに正規化まで置くか: `AI_THINKING_LEVEL` は生成側 (`ai-factory.ts`)、
 * `VISION_API_THINKING_LEVEL` / `VISION_API_MEDIA_RESOLUTION` は Vision 側
 * (`vision-api-service.factory.ts`) が読む。両方が同じ変換を必要とするため、
 * 変換ロジックを 1 箇所に置いて二重実装を避ける。
 *
 * @module lib/config/gemini-models
 * @see https://ai.google.dev/gemini-api/docs/models
 * @see https://ai.google.dev/gemini-api/docs/pricing
 */

import { MediaResolution, ThinkingLevel } from '@google/genai';

/**
 * 現行世代の Gemini モデル
 *
 * 状態は公式の Model deprecations ページを一次情報とする (2026-08-16 時点):
 *
 * | 定数 | モデル | 状態 | 単価 (入力 / 出力 per 1M) |
 * |---|---|---|---|
 * | `FLASH_3_7` | gemini-3.7-flash | ⚠️ **公式 docs 未掲載・単価未公表** (下記) | 不明 |
 * | `FLASH` (**既定**) | gemini-3.6-flash | 2026-07-21 GA / shutdown 未announce | $0.75 / $3.75 |
 * | `FLASH_3_5` | gemini-3.5-flash | 2026-05-19 GA / shutdown 未announce | $1.50 / $9.00 |
 * | `FLASH_LITE` | gemini-3.5-flash-lite | 2026-07-21 GA / shutdown 未announce | $0.30 / $2.50 |
 * | `FLASH_LITE_3_1` | gemini-3.1-flash-lite | ⚠️ **shutdown 2027-05-07** → `FLASH_LITE` へ | $0.25 / $1.50 |
 *
 * ⚠️ **`FLASH_3_7` は実 API では応答するが、公式の pricing / models / deprecations /
 * changelog のいずれにも掲載がない (2026-08-16 実測)。単価が不明なため
 * `MODEL_PRICING` に登録できず、使うと cost-tracker がフォールバック単価で
 * 誤集計する。単価が公表されるまでコスト比較の対象にしないこと。**
 *
 * ⚠️ **`gemini-3.6-flash` の単価は 2027-01-01 に $1.50 / $7.50 へ倍増する**
 * (プロモーション価格の終了)。`lib/ai/cost/model-pricing.ts` は静的テーブルのため
 * 自動追随しない。
 *
 * 旧世代 (`gemini-2.0-*` / `gemini-2.5-*`) は全て廃止期日を経過または経過予定のため
 * 本定数からは撤去した。過去ログの再集計用に価格テーブル側のエントリだけは残している。
 */
export const GEMINI_MODELS = {
  /** 最新世代。⚠️ 単価未公表のためコスト比較には使わない */
  FLASH_3_7: 'gemini-3.7-flash',
  /** DEFAULT: 現行の主力。Google が `gemini-2.5-flash` の推奨移行先に指定している */
  FLASH: 'gemini-3.6-flash',
  /** 1 世代前の Flash。3.6 Flash より入力で 2 倍・出力で 2.4 倍高い */
  FLASH_3_5: 'gemini-3.5-flash',
  /** 現行の最安。入力偏重ワークロードではこれが最もコスト効率が良い */
  FLASH_LITE: 'gemini-3.5-flash-lite',
  /** ⚠️ shutdown 2027-05-07。移行先は `FLASH_LITE` */
  FLASH_LITE_3_1: 'gemini-3.1-flash-lite',
} as const;

/**
 * 既定モデル
 *
 * `gemini-3.6-flash` を選ぶ理由: 現行 GA で shutdown が announce されておらず、
 * Google 自身が `gemini-2.5-flash` / `gemini-3-flash-preview` の推奨移行先に
 * 指定しているため。単価も公表されており cost-tracker が正しく集計できる。
 */
export const DEFAULT_GEMINI_MODEL: string = GEMINI_MODELS.FLASH;

/** 型安全のためのモデル型 (env 経由で任意の文字列も来るため provider 側は string で受ける) */
export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

// ─────────────────────────────────────────────────────────────────────────────
// 呼び出し設定の正規化 (env 文字列 → SDK enum)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * thinking の既定値
 *
 * `LOW` を既定にする理由: 本パイプラインは抽出・分類が中心で入力:出力が約 33:1 の
 * 入力偏重ワークロードであり、深い推論を要する場面が薄い。一方 **Gemini 3.x は
 * thinking トークンを出力として課金する**ため、既定の `MEDIUM` のままだと出力側の
 * コストが読めなくなる。
 *
 * 実測 (2026-08-16、同一プロンプト):
 * - `gemini-3.6-flash`: LOW = 68 thoughts / MEDIUM = 145 thoughts
 * - `gemini-3.5-flash-lite`: LOW = 0 thoughts / MEDIUM = 47 thoughts
 */
export const DEFAULT_GEMINI_THINKING_LEVEL = ThinkingLevel.LOW;

/**
 * Vision の画像解像度の既定値
 *
 * `MEDIA_RESOLUTION_LOW` を既定にする理由: **未指定時の Gemini の既定は HIGH 相当**で、
 * 画像 1 枚あたり 1,083 入力トークンかかる (2026-08-16 実測)。LOW なら 252 トークンで、
 * OpenAI Vision 側の既定 (`VISION_API_DETAIL=low`) ともコスト感が揃う。
 *
 * 実測 (`gemini-3.6-flash`、画像 1 枚あたりの入力トークン):
 * - 未指定 = 1,083 / LOW = 252 / MEDIUM = 520 / HIGH = 1,083
 * - **画像のバイト数を変えてもトークンは動かず、本設定だけで決まる**
 *
 * ⚠️ メニュー画像の文字読み取り精度が不足する場合は
 * `VISION_API_MEDIA_RESOLUTION=MEDIUM` 等で引き上げる (コストは比例して増える)。
 */
export const DEFAULT_GEMINI_MEDIA_RESOLUTION = MediaResolution.MEDIA_RESOLUTION_LOW;

const THINKING_LEVEL_BY_INPUT: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const MEDIA_RESOLUTION_BY_INPUT: Record<string, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

/**
 * env 文字列を `ThinkingLevel` へ正規化する (Layer 1: 純粋関数)
 *
 * 受け付ける表記は大文字小文字を問わず `minimal` / `low` / `medium` / `high`、および
 * SDK enum の値そのまま (`MEDIUM` / `THINKING_LEVEL_MEDIUM` 等) も許容する。
 *
 * @param value - `AI_THINKING_LEVEL` / `VISION_API_THINKING_LEVEL` の生値
 * @returns 対応する `ThinkingLevel`。未設定・不正値は既定値 (`LOW`)
 */
export function normalizeThinkingLevel(value?: string): ThinkingLevel {
  const key = value?.trim().toLowerCase().replace(/^thinking_level_/, '');

  if (!key) {
    return DEFAULT_GEMINI_THINKING_LEVEL;
  }

  const level = THINKING_LEVEL_BY_INPUT[key];
  if (level) {
    return level;
  }

  console.warn(
    `THINKING_LEVEL="${value}" is not valid. Falling back to "${DEFAULT_GEMINI_THINKING_LEVEL}". ` +
      `Valid options: ${Object.keys(THINKING_LEVEL_BY_INPUT).join(', ')}`
  );
  return DEFAULT_GEMINI_THINKING_LEVEL;
}

/**
 * env 文字列を `MediaResolution` へ正規化する (Layer 1: 純粋関数)
 *
 * 受け付ける表記は大文字小文字を問わず `low` / `medium` / `high`、および
 * SDK enum の値そのまま (`MEDIA_RESOLUTION_HIGH` 等) も許容する。
 *
 * @param value - `VISION_API_MEDIA_RESOLUTION` の生値
 * @returns 対応する `MediaResolution`。未設定・不正値は既定値 (`LOW`)
 */
export function normalizeMediaResolution(value?: string): MediaResolution {
  const key = value?.trim().toLowerCase().replace(/^media_resolution_/, '');

  if (!key) {
    return DEFAULT_GEMINI_MEDIA_RESOLUTION;
  }

  const resolution = MEDIA_RESOLUTION_BY_INPUT[key];
  if (resolution) {
    return resolution;
  }

  console.warn(
    `VISION_API_MEDIA_RESOLUTION="${value}" is not valid. ` +
      `Falling back to "${DEFAULT_GEMINI_MEDIA_RESOLUTION}". ` +
      `Valid options: ${Object.keys(MEDIA_RESOLUTION_BY_INPUT).join(', ')}`
  );
  return DEFAULT_GEMINI_MEDIA_RESOLUTION;
}
