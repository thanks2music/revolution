import type { ReviewScreeningReason } from '@revolution/schemas/review';

/**
 * 口コミの審査器の口 (仕様: 差し替えのできる 3 つの口の 1 つ)。
 *
 * 本番は Gemini (`gemini-screener.ts`)、テストと E2E は偽物 (`fake-screener.ts`)。
 * 呼び出し側 (口コミの操作の層) は、この形だけを知る。
 *
 * **例外を投げない。** 失敗は `{ ok: false }` で返し、呼び出し側が「AI 審査の失敗」として
 * BOSS の確認待ちに回す (公開されない側に倒す)。
 */
export interface ReviewScreener {
  screen(input: ReviewScreeningInput): Promise<ReviewScreeningResult>;
}

export interface ReviewScreeningInput {
  /** 本文 (無ければ null。星などだけの口コミも審査に回す) */
  body: string | null;
}

export type ReviewScreeningResult =
  | {
      ok: true;
      decision: 'publish' | 'reject' | 'unsure';
      /** reject の時の理由 (審査の 4 種) */
      reasonCode: ReviewScreeningReason | null;
      /** 判断の短い説明 (管理画面だけで見る) */
      reason: string;
      /** 使ったモデル (AI の記録に残す) */
      model: string;
    }
  | {
      ok: false;
      /** 失敗の内容 (AI の記録に残す。本文・鍵は含めない) */
      error: string;
      model: string | null;
    };
