import { describe, expect, it } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import {
  CLAUDE_MAX_NONSTREAMING_TOKENS,
  CLAUDE_MIN_MAX_TOKENS,
  CLAUDE_THINKING_SETTINGS,
  ClaudeIncompleteResponseError,
  DEFAULT_CLAUDE_MODEL,
  assertClaudeResponseComplete,
  claudeMaxTokens,
  getClaudeResponseText,
} from '@/lib/config/claude-models';

/**
 * Claude の共通のリクエスト設定と応答の読み取り (Layer 1)。
 *
 * 2026-10-11 に Sonnet 4.5 から Sonnet 5.5 へ移行した。Sonnet 5.5 は thinking を省くと
 * adaptive + effort high で動き、応答の先頭に thinking のブロックが来ることがある。
 */

type Content = Pick<Anthropic.Message, 'content'>;

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as Anthropic.TextBlock;
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig' }) as Anthropic.ThinkingBlock;

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

  it('ストリームなしで SDK が送れる上限 (21,333) を超えない', () => {
    // 21,334 以上は SDK が送る前に「Streaming is required」で例外にする
    expect(claudeMaxTokens(32_000)).toBe(CLAUDE_MAX_NONSTREAMING_TOKENS);
    expect((60 * 60 * 1000 * CLAUDE_MAX_NONSTREAMING_TOKENS) / 128_000).toBeLessThanOrEqual(10 * 60 * 1000);
    expect((60 * 60 * 1000 * (CLAUDE_MAX_NONSTREAMING_TOKENS + 1)) / 128_000).toBeGreaterThan(10 * 60 * 1000);
  });
});

describe('assertClaudeResponseComplete', () => {
  it('最後まで書かれた応答 (end_turn) は通す', () => {
    expect(() => assertClaudeResponseComplete({ stop_reason: 'end_turn', stop_details: null }, 'test')).not.toThrow();
  });

  it('拒否は分類の名前付きで失敗にする', () => {
    const refusal = {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
    } as unknown as Pick<Anthropic.Message, 'stop_reason' | 'stop_details'>;

    expect(() => assertClaudeResponseComplete(refusal, 'title-generation')).toThrow(
      new ClaudeIncompleteResponseError('refusal', '[title-generation] Claude refused the request (category: general_harms)')
    );
  });

  it('max_tokens での切り詰めは失敗にする', () => {
    expect(() =>
      assertClaudeResponseComplete({ stop_reason: 'max_tokens', stop_details: null }, 'content-generation')
    ).toThrow(/truncated \(stop_reason=max_tokens\)/);
  });
});

describe('getClaudeResponseText', () => {
  it('text のブロックを返す', () => {
    const message: Content = { content: [text('{"ok":1}')] };
    expect(getClaudeResponseText(message)).toBe('{"ok":1}');
  });

  it('先頭が thinking のブロックでも、text のブロックを返す', () => {
    const message: Content = { content: [thinking(), text('本文')] };
    expect(getClaudeResponseText(message)).toBe('本文');
  });

  it('text のブロックが複数あればつなげる', () => {
    const message: Content = { content: [text('前半'), thinking(), text('後半')] };
    expect(getClaudeResponseText(message)).toBe('前半後半');
  });

  it('text のブロックが無ければ null', () => {
    expect(getClaudeResponseText({ content: [thinking()] })).toBeNull();
    expect(getClaudeResponseText({ content: [] })).toBeNull();
  });
});
