import { describe, expect, it } from '@jest/globals';

import {
  CLAUDE_MIN_MAX_TOKENS,
  CLAUDE_THINKING_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
  claudeMaxTokens,
} from '@/lib/config/claude-models';

/**
 * Claude の共通のリクエスト設定 (Layer 1)。
 *
 * 2026-10-11 に Sonnet 4.5 から Sonnet 5.5 へ移行した。Sonnet 5.5 は thinking を省くと
 * adaptive + effort high で動き、思考のトークンも max_tokens に含まれる。
 */

describe('Claude の既定モデルと思考の設定', () => {
  it('既定モデルは claude-sonnet-5-5 (日付の接尾辞なし)', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5-5');
  });

  it('adaptive thinking と effort low を送る', () => {
    expect(CLAUDE_THINKING_SETTINGS).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
    });
  });
});

describe('claudeMaxTokens', () => {
  it('返答の上限が小さくても、思考の分を見込んだ下限まで引き上げる', () => {
    expect(claudeMaxTokens(100)).toBe(CLAUDE_MIN_MAX_TOKENS);
  });

  it('返答の上限が下限より大きければ、そのまま使う', () => {
    expect(claudeMaxTokens(20_000)).toBe(20_000);
  });
});
