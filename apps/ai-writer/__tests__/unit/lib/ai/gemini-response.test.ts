/**
 * Layer 1 tests for Gemini 応答の異常系検出。
 *
 * ⚠️ **Gemini は異常終了でも例外を投げない。** `finishReason` と (あれば) 途中までの
 * 文字列を返すだけなので、素直に `response.text` を読むと壊れた値が下流へ流れる。
 * 実測 (2026-08-16、`gemini-3.6-flash`、`maxTokens: 100` + thinking LOW) では
 * slug が `kusuriya-no-hitorigoto` ではなく `kusuriya-` になった。
 *
 * ここは生成側と Vision 側の**両方**が通る唯一の判定なので、ここが緩むと両方緩む。
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  GeminiBlockedResponseError,
  GeminiTruncatedResponseError,
  readGeminiText,
} from '@/lib/ai/gemini-response';

const CTX = {
  label: 'TestCaller',
  modelName: 'gemini-3.6-flash',
  thinkingLevel: 'LOW',
  thinkingEnvName: 'AI_THINKING_LEVEL',
};

function res(text: string | undefined, finishReason?: string): GenerateContentResponse {
  return {
    text,
    candidates: finishReason ? [{ finishReason }] : undefined,
    usageMetadata: { thoughtsTokenCount: 92, candidatesTokenCount: 4 },
  } as unknown as GenerateContentResponse;
}

describe('readGeminiText', () => {
  it('finishReason=STOP なら本文を返す', () => {
    expect(readGeminiText(res('kusuriya-no-hitorigoto', 'STOP'), CTX)).toBe(
      'kusuriya-no-hitorigoto'
    );
  });

  it('finishReason が未報告でも本文を返す', () => {
    expect(readGeminiText(res('ok'), CTX)).toBe('ok');
  });

  it('text が undefined なら空文字を返す (STOP のとき)', () => {
    expect(readGeminiText(res(undefined, 'STOP'), CTX)).toBe('');
  });

  describe('切り詰め (MAX_TOKENS)', () => {
    it('専用のエラー型で throw する', () => {
      expect(() => readGeminiText(res('kusuriya-', 'MAX_TOKENS'), CTX)).toThrow(
        GeminiTruncatedResponseError
      );
    });

    it('原因と対処が分かるメッセージを出す', () => {
      try {
        readGeminiText(res('kusuriya-', 'MAX_TOKENS'), CTX);
        throw new Error('should have thrown');
      } catch (e) {
        const message = (e as Error).message;
        expect(message).toContain('MAX_TOKENS');
        expect(message).toContain('thoughtsTokens=92');
        // どの env を下げればよいかを呼び出し元ごとに案内する
        expect(message).toContain('AI_THINKING_LEVEL');
      }
    });

    it('Vision 側からは VISION_API_THINKING_LEVEL を案内する', () => {
      try {
        readGeminiText(res('{"menuItems":[{"name":"コラボ', 'MAX_TOKENS'), {
          ...CTX,
          label: 'GeminiVisionService',
          thinkingEnvName: 'VISION_API_THINKING_LEVEL',
        });
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('VISION_API_THINKING_LEVEL');
      }
    });
  });

  describe('コンテンツブロック等 (STOP 以外)', () => {
    /**
     * 🔴 これらは `text` が undefined になりうる。空文字を「正常な結果」として返すと、
     * slug が空になったり Vision の抽出が空配列になったりして、原因から離れた場所で
     * 症状だけが出る。
     */
    it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'OTHER'])(
      'finishReason=%s を throw する',
      (reason) => {
        expect(() => readGeminiText(res(undefined, reason), CTX)).toThrow(
          GeminiBlockedResponseError
        );
      }
    );

    it('finishReason をエラーに載せる', () => {
      try {
        readGeminiText(res(undefined, 'SAFETY'), CTX);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GeminiBlockedResponseError);
        expect((e as GeminiBlockedResponseError).finishReason).toBe('SAFETY');
      }
    });

    it('ブロックされた応答の本文は下流へ渡さない', () => {
      // 部分的に text が入っていても信用しない
      expect(() => readGeminiText(res('部分的な出力', 'SAFETY'), CTX)).toThrow(
        GeminiBlockedResponseError
      );
    });
  });
});
