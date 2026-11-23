// shared/slack (`@revolution/slack`) のテスト。shared のパッケージは自分の jest を持たないので、
// shared/schemas と同じく、CI で単体テストを走らせている apps/frontend の側に置く。
import { describe, expect, it } from '@jest/globals';

import { presentEnvValue } from '@revolution/slack/env';
import { escapeAndTruncate, escapeSlackText, truncate } from '@revolution/slack/text';

describe('escapeSlackText', () => {
  it('Slack の制御文字 & < > をエスケープする (<!channel> で全員に通知が飛ぶのを防ぐ)', () => {
    expect(escapeSlackText('<!channel> A & B > C')).toBe('&lt;!channel&gt; A &amp; B &gt; C');
  });
});

describe('truncate', () => {
  it('上限以下ならそのまま返す', () => {
    expect(truncate('あいう', 3)).toBe('あいう');
  });

  it('上限を超えたら末尾を … にする', () => {
    expect(truncate('あいうえお', 3)).toBe('あい…');
  });

  it('絵文字のサロゲートペアを割らない', () => {
    expect(truncate('😀😀😀😀', 3)).toBe('😀😀…');
  });
});

describe('presentEnvValue', () => {
  it('前後の空白を除いた値を返す', () => {
    expect(presentEnvValue('  C0123 ')).toBe('C0123');
  });

  it.each([undefined, '', '   ', 'op://vault/item/field'])(
    '%p は未設定とみなす (op:// は 1Password の参照のまま)',
    (value) => {
      expect(presentEnvValue(value)).toBeUndefined();
    },
  );
});

describe('escapeAndTruncate', () => {
  it('上限以内ならエスケープするだけ', () => {
    expect(escapeAndTruncate('a & <b>', 100)).toBe('a &amp; &lt;b&gt;');
  });

  it('エスケープした後の長さで max 字に収める', () => {
    const result = escapeAndTruncate('&'.repeat(100), 12);
    expect(Array.from(result).length).toBeLessThanOrEqual(12);
    expect(result).toBe('&amp;&amp;…');
  });

  it('末尾で entity を割らない', () => {
    expect(escapeAndTruncate('ab&cd', 5)).toBe('ab…');
  });
});
