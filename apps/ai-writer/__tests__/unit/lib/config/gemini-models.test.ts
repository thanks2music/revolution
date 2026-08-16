/**
 * Layer 1 tests for Gemini model constants and env normalizers.
 *
 * 正規化は `ai-factory.ts` (生成側) と `vision-api-service.factory.ts` (Vision 側) の
 * 両方から呼ばれる純粋関数なので、両者が同じ挙動になることをここで固定する。
 *
 * ⚠️ 既定値のテストは飾りではない。**Gemini 側の既定は thinking=medium /
 * media resolution=high 相当**で、どちらもコストに直結する。既定を LOW に倒している
 * ことが崩れると、気づかないままコストが数倍になる。
 */

import { MediaResolution, ThinkingLevel } from '@google/genai';
import {
  DEFAULT_GEMINI_MEDIA_RESOLUTION,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_THINKING_LEVEL,
  GEMINI_MODELS,
  normalizeMediaResolution,
  normalizeThinkingLevel,
} from '@/lib/config/gemini-models';

describe('GEMINI_MODELS', () => {
  it('既定モデルは gemini-3.6-flash', () => {
    // 現行 GA かつ Google 自身が gemini-2.5-flash の推奨移行先に指定しているモデル。
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.6-flash');
    expect(DEFAULT_GEMINI_MODEL).toBe(GEMINI_MODELS.FLASH);
  });

  it('廃止済みの 2.x 系を定数に含めない', () => {
    // 2026-08 時点で 2.0 / 2.5 系は全て廃止期日を経過している。価格表側には過去ログの
    // 再集計用に残すが、新規に選べる定数からは外す。
    const models = Object.values(GEMINI_MODELS);
    expect(models.filter((m) => m.startsWith('gemini-2.'))).toHaveLength(0);
  });

  it('検証対象の 2 モデルを含む', () => {
    const models = Object.values(GEMINI_MODELS);
    expect(models).toContain('gemini-3.6-flash');
    expect(models).toContain('gemini-3.5-flash-lite');
  });
});

describe('normalizeThinkingLevel', () => {
  it('未設定なら既定の LOW', () => {
    expect(normalizeThinkingLevel(undefined)).toBe(ThinkingLevel.LOW);
    expect(normalizeThinkingLevel('')).toBe(ThinkingLevel.LOW);
    expect(normalizeThinkingLevel('   ')).toBe(ThinkingLevel.LOW);
    expect(DEFAULT_GEMINI_THINKING_LEVEL).toBe(ThinkingLevel.LOW);
  });

  it.each([
    ['minimal', ThinkingLevel.MINIMAL],
    ['low', ThinkingLevel.LOW],
    ['medium', ThinkingLevel.MEDIUM],
    ['high', ThinkingLevel.HIGH],
  ])('小文字表記 %s を解決する', (input, expected) => {
    expect(normalizeThinkingLevel(input)).toBe(expected);
  });

  it('大文字・前後空白・SDK enum 値そのままも受け付ける', () => {
    expect(normalizeThinkingLevel('MEDIUM')).toBe(ThinkingLevel.MEDIUM);
    expect(normalizeThinkingLevel('  High  ')).toBe(ThinkingLevel.HIGH);
    expect(normalizeThinkingLevel('THINKING_LEVEL_MINIMAL')).toBe(ThinkingLevel.MINIMAL);
  });

  it('不正値は throw せず既定へフォールバックする', () => {
    // env の打ち間違いでパイプライン全体を止めない (getConfiguredProvider と同じ方針)。
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeThinkingLevel('turbo')).toBe(ThinkingLevel.LOW);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('normalizeMediaResolution', () => {
  /**
   * 🔴 既定を LOW にしているのは実測に基づく。`gemini-3.6-flash` で画像 1 枚あたり
   * 未指定 = 1,083 / low = 252 / medium = 520 / high = 1,083 入力トークン
   * (2026-08-16 実測。画像のバイト数では変わらない)。
   */
  it('未設定なら既定の LOW', () => {
    expect(normalizeMediaResolution(undefined)).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    expect(normalizeMediaResolution('')).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    expect(DEFAULT_GEMINI_MEDIA_RESOLUTION).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
  });

  it.each([
    ['low', MediaResolution.MEDIA_RESOLUTION_LOW],
    ['medium', MediaResolution.MEDIA_RESOLUTION_MEDIUM],
    ['high', MediaResolution.MEDIA_RESOLUTION_HIGH],
  ])('小文字表記 %s を解決する', (input, expected) => {
    expect(normalizeMediaResolution(input)).toBe(expected);
  });

  it('SDK enum 値そのままも受け付ける', () => {
    expect(normalizeMediaResolution('MEDIA_RESOLUTION_HIGH')).toBe(
      MediaResolution.MEDIA_RESOLUTION_HIGH
    );
  });

  it('不正値は throw せず既定へフォールバックする', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeMediaResolution('ultra')).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
