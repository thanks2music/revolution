import type { ReviewScreeningReason } from '@revolution/schemas/review';
import type {
  ReviewPhotoScreeningDecision,
  ReviewScreeningDecision,
} from '@revolution/schemas/review-screening-response';

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
  /** 付けた写真 (並びの順。変換した表示用の物)。無ければ空 */
  photos: ReviewScreeningPhoto[];
}

export interface ReviewScreeningPhoto {
  data: Uint8Array;
  mimeType: string;
}

/** 写真 1 枚の判定 (入力の写真と同じ順) */
export interface ReviewPhotoScreening {
  decision: ReviewPhotoScreeningDecision;
  /** hide の時の理由 (審査の 4 種) */
  reasonCode: ReviewScreeningReason | null;
}

export type ReviewScreeningResult =
  | {
      ok: true;
      decision: ReviewScreeningDecision;
      /** reject の時の理由 (審査の 4 種) */
      reasonCode: ReviewScreeningReason | null;
      /** 判断の短い説明 (管理画面だけで見る) */
      reason: string;
      /** 使ったモデル (AI の記録に残す) */
      model: string;
      /** 写真ごとの判定 (入力の写真と同じ数・同じ順) */
      photos: ReviewPhotoScreening[];
    }
  | {
      ok: false;
      /** 失敗の内容 (AI の記録に残す。本文・鍵は含めない) */
      error: string;
      model: string | null;
    };
