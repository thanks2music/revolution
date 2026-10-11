import { describe, expect, it } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import {
  CLAUDE_MIN_MAX_TOKENS,
  CLAUDE_THINKING_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
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
    expect(claudeMaxTokens(32_000)).toBe(32_000);
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
