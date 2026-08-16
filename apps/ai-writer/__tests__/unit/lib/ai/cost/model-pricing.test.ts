/**
 * Layer 1 unit tests for `calculateCost` covering prompt-cache pricing.
 *
 * Pricing assumptions (per `model-pricing.ts` / Anthropic public pricing):
 * - claude-sonnet-4-5-20250929: input $3.00/1M, cachedInput $0.30/1M, output $15.00/1M
 * - cache creation (5m TTL ephemeral): inputPer1M * 1.25 = $3.75/1M
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  calculateCost,
  formatCost,
  isKnownModel,
  MODEL_PRICING,
  CACHE_WRITE_5M_MULTIPLIER,
  type TokenUsage,
} from '@/lib/ai/cost/model-pricing';

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_INPUT_PER_M = 3.0;
const CLAUDE_CACHED_INPUT_PER_M = 0.3;
const CLAUDE_OUTPUT_PER_M = 15.0;

describe('calculateCost — prompt cache pricing', () => {
  it('calculates regular input + output cost (baseline, no cache)', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.inputCost).toBeCloseTo(CLAUDE_INPUT_PER_M, 5);
    expect(cost.breakdown.outputCost).toBeCloseTo(CLAUDE_OUTPUT_PER_M, 5);
    expect(cost.breakdown.cachedCost).toBe(0);
    expect(cost.breakdown.cacheCreationCost).toBe(0);
    expect(cost.usd).toBeCloseTo(CLAUDE_INPUT_PER_M + CLAUDE_OUTPUT_PER_M, 5);
  });

  it('applies 1.25x multiplier when only cacheCreationTokens are present', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 1_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    const expectedCacheCreationCost = CLAUDE_INPUT_PER_M * CACHE_WRITE_5M_MULTIPLIER;
    expect(cost.breakdown.cacheCreationCost).toBeCloseTo(expectedCacheCreationCost, 5);
    expect(cost.breakdown.inputCost).toBe(0);
    expect(cost.breakdown.cachedCost).toBe(0);
    expect(cost.usd).toBeCloseTo(expectedCacheCreationCost, 5);
  });

  it('applies cachedInputPer1M (0.1x) when only cachedTokens are present', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 1_000_000,
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.cachedCost).toBeCloseTo(CLAUDE_CACHED_INPUT_PER_M, 5);
    expect(cost.breakdown.cacheCreationCost).toBe(0);
    expect(cost.breakdown.inputCost).toBe(0);
    expect(cost.usd).toBeCloseTo(CLAUDE_CACHED_INPUT_PER_M, 5);
  });

  it('sums regular input + cache creation + cache read independently', () => {
    const usage: TokenUsage = {
      promptTokens: 500_000,         // regular @ $3/M = $1.50
      completionTokens: 100_000,     // output @ $15/M = $1.50
      totalTokens: 600_000,
      cacheCreationTokens: 200_000,  // cache write @ $3.75/M = $0.75
      cachedTokens: 800_000,         // cache read @ $0.30/M = $0.24
    };

    const cost = calculateCost(CLAUDE_MODEL, usage);

    expect(cost.breakdown.inputCost).toBeCloseTo(1.5, 5);
    expect(cost.breakdown.outputCost).toBeCloseTo(1.5, 5);
    expect(cost.breakdown.cacheCreationCost).toBeCloseTo(0.75, 5);
    expect(cost.breakdown.cachedCost).toBeCloseTo(0.24, 5);
    expect(cost.usd).toBeCloseTo(1.5 + 1.5 + 0.75 + 0.24, 5);
  });

  it('exposes breakdown.cacheCreationCost as 0 when no cache tokens are passed', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    });

    expect(cost.breakdown).toHaveProperty('cacheCreationCost');
    expect(cost.breakdown.cacheCreationCost).toBe(0);
  });

  it('falls back to gpt-4o-mini pricing for unknown models', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    };

    const cost = calculateCost('non-existent-model-xyz', usage);

    // gpt-4o-mini: inputPer1M = 0.15
    expect(cost.breakdown.inputCost).toBeCloseTo(0.15, 5);
  });

  it('treats cacheCreationTokens=0 as no-op (does not synthesize cost)', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cacheCreationTokens: 0,
    });

    expect(cost.breakdown.cacheCreationCost).toBe(0);
  });

  it('formats cost with cache creation included in usd total (formatCost lock-in)', () => {
    const cost = calculateCost(CLAUDE_MODEL, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 1_000_000,
    });

    const formatted = formatCost(cost);
    // $3.75 falls in the >= $0.01 branch, so 4-decimal format
    expect(formatted).toMatch(/^\$3\.7500 \(¥\d/);
  });

  describe('GPT-5.4 / 5.5 pricing (added 2026-06-07)', () => {
    it('calculates input + output cost for gpt-5.4-mini (default model post 2026-06-07)', () => {
      // gpt-5.4-mini: input $0.75/M, cachedInput $0.075/M, output $4.50/M
      const usage: TokenUsage = {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
      };

      const cost = calculateCost('gpt-5.4-mini', usage);

      expect(cost.breakdown.inputCost).toBeCloseTo(0.75, 5);
      expect(cost.breakdown.outputCost).toBeCloseTo(4.5, 5);
      expect(cost.breakdown.cachedCost).toBe(0);
      expect(cost.usd).toBeCloseTo(5.25, 5);
    });

    it('retains gpt-4.1-nano pricing for historical cost-log replay (EOL 2026-10-23)', () => {
      // gpt-4.1-nano: input $0.10/M, output $0.40/M — kept until API shutdown
      const usage: TokenUsage = {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
      };

      const cost = calculateCost('gpt-4.1-nano', usage);

      expect(cost.breakdown.inputCost).toBeCloseTo(0.1, 5);
      expect(cost.breakdown.outputCost).toBeCloseTo(0.4, 5);
      expect(cost.usd).toBeCloseTo(0.5, 5);
    });

    it('applies cached input pricing for gpt-5.5 (premium tier)', () => {
      // gpt-5.5: input $5.00/M, cachedInput $0.50/M, output $30.00/M
      const usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 1_000_000,
      };

      const cost = calculateCost('gpt-5.5', usage);

      expect(cost.breakdown.cachedCost).toBeCloseTo(0.5, 5);
      expect(cost.breakdown.inputCost).toBe(0);
      expect(cost.breakdown.outputCost).toBe(0);
      expect(cost.usd).toBeCloseTo(0.5, 5);
    });
  });
});

/**
 * Google Gemini 3.x の単価と、Gemini 特有の課金構造のテスト。
 *
 * ⚠️ **既定モデルが価格表に無いと `gpt-4o-mini` 単価へ黙ってフォールバックする。**
 * 実際に旧既定の `gemini-2.5-flash-lite` はエントリが無く、Gemini 経路のコストは
 * 誤った単価で集計され続けていた (2026-08-16 是正)。同じ穴を再発させないための固定。
 */
describe('calculateCost — Google Gemini 3.x', () => {
  it.each([
    ['gemini-3.6-flash', 0.75, 3.75],
    ['gemini-3.5-flash', 1.5, 9.0],
    ['gemini-3.5-flash-lite', 0.3, 2.5],
    ['gemini-3.1-flash-lite', 0.25, 1.5],
  ])('%s は公式単価どおりに計算する', (model, inputPerM, outputPerM) => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    };

    const cost = calculateCost(model, usage);

    expect(cost.breakdown.inputCost).toBeCloseTo(inputPerM, 5);
    expect(cost.breakdown.outputCost).toBeCloseTo(outputPerM, 5);
  });

  it('検証対象の 2 モデルは価格表に登録済み (フォールバックしない)', () => {
    // ここが崩れると実走のコスト集計が丸ごと誤る。
    expect(isKnownModel('gemini-3.6-flash')).toBe(true);
    expect(isKnownModel('gemini-3.5-flash-lite')).toBe(true);
  });

  it('旧世代も retention として残す (過去 cost log の再集計用)', () => {
    // PR #243 で旧エントリを即削除して過去ログが誤集計になった先例がある。
    expect(isKnownModel('gemini-2.5-flash-lite')).toBe(true);
    expect(isKnownModel('gemini-2.5-flash')).toBe(true);
    expect(isKnownModel('gemini-2.5-pro')).toBe(true);
  });

  /**
   * ⚠️ `gemini-3.7-flash` は実 API では応答するが公式に単価が公表されていない。
   * 推測値を入れると「一見動くが金額が嘘」という最悪の状態になるため、
   * **意図的に登録していない**ことを固定する。
   */
  it('単価未公表の gemini-3.7-flash は意図的に未登録', () => {
    expect(isKnownModel('gemini-3.7-flash')).toBe(false);
  });

  it('未知の Gemini モデルは警告のうえフォールバックする', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 };

    const cost = calculateCost('gemini-9.9-imaginary', usage);

    expect(warn).toHaveBeenCalled();
    // gpt-4o-mini の $0.15/M へ倒れる
    expect(cost.breakdown.inputCost).toBeCloseTo(0.15, 5);
    warn.mockRestore();
  });

  it('Gemini 3.x は cached input 単価を持つ (旧エントリは未定義だった)', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 1_000_000,
    };

    // gemini-3.6-flash: cachedInput $0.075/M
    expect(calculateCost('gemini-3.6-flash', usage).breakdown.cachedCost).toBeCloseTo(0.075, 5);
    // gemini-3.5-flash-lite: cachedInput $0.03/M
    expect(calculateCost('gemini-3.5-flash-lite', usage).breakdown.cachedCost).toBeCloseTo(
      0.03,
      5
    );
  });

  /**
   * 🔴 thinking トークンは「出力」として課金される。provider / Vision service 側で
   * `completionTokens = candidatesTokenCount + thoughtsTokenCount` として渡す契約に
   * なっており、その前提で金額が合うことをここで確認する。
   */
  it('thinking 込みの completionTokens が出力単価で計上される', () => {
    // 実測の検算値: prompt 13 / candidates 3 / thoughts 68 (gemini-3.6-flash, thinking=LOW)
    const usage: TokenUsage = {
      promptTokens: 13,
      completionTokens: 3 + 68,
      totalTokens: 84,
    };

    const cost = calculateCost('gemini-3.6-flash', usage);

    expect(cost.breakdown.inputCost).toBeCloseTo((13 / 1_000_000) * 0.75, 10);
    expect(cost.breakdown.outputCost).toBeCloseTo((71 / 1_000_000) * 3.75, 10);
  });

  it('Gemini エントリの provider は全て google', () => {
    const geminiEntries = Object.entries(MODEL_PRICING).filter(([name]) =>
      name.startsWith('gemini-')
    );

    expect(geminiEntries.length).toBeGreaterThan(0);
    for (const [, pricing] of geminiEntries) {
      expect(pricing.provider).toBe('google');
    }
  });
});
