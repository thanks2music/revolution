import { describe, expect, it } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import { ClaudeIncompleteResponseError, readClaudeText } from '@/lib/ai/claude-response';

/**
 * Claude の応答の読み取り (Layer 1)。
 *
 * Sonnet 5.5 の adaptive thinking では応答の先頭に thinking のブロックが来ることがあり、
 * 拒否 (refusal) と切り詰め (max_tokens) は HTTP 200 で返る。
 */

type Message = Pick<Anthropic.Message, 'content' | 'stop_reason' | 'stop_details'>;

const text = (value: string) => ({ type: 'text', text: value, citations: null }) as Anthropic.TextBlock;
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig' }) as Anthropic.ThinkingBlock;
const message = (content: Anthropic.ContentBlock[], stop: Partial<Message> = {}): Message => ({
  content,
  stop_reason: 'end_turn',
  stop_details: null,
  ...stop,
});

describe('readClaudeText', () => {
  it('text のブロックを返す', () => {
    expect(readClaudeText(message([text('{"ok":1}')]), 'test')).toBe('{"ok":1}');
  });

  it('先頭が thinking のブロックでも、text のブロックを返す', () => {
    expect(readClaudeText(message([thinking(), text('本文')]), 'test')).toBe('本文');
  });

  it('text のブロックが複数あればつなげる', () => {
    expect(readClaudeText(message([text('前半'), thinking(), text('後半')]), 'test')).toBe('前半後半');
  });

  it('text のブロックが無ければ失敗にする', () => {
    expect(() => readClaudeText(message([thinking()]), 'title-generation')).toThrow(
      '[title-generation] No text content in Claude response'
    );
  });

  it('拒否は分類の名前付きで失敗にする', () => {
    const refusal = message([], {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
    } as unknown as Partial<Message>);

    expect(() => readClaudeText(refusal, 'title-generation')).toThrow(
      new ClaudeIncompleteResponseError(
        'refusal',
        '[title-generation] Claude refused the request (category: general_harms)'
      )
    );
  });

  it('max_tokens での切り詰めは、途中の text があっても失敗にする', () => {
    const truncated = message([text('{"title":"途中で')], { stop_reason: 'max_tokens' });

    expect(() => readClaudeText(truncated, 'content-generation')).toThrow(
      /truncated \(stop_reason=max_tokens\)/
    );
  });
});
