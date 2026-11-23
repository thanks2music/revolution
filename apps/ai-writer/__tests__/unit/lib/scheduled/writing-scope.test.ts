import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  describeWritingScope,
  judgeWritingScope,
  loadWritingScope,
  operatorFromProfile,
  parseWritingScope,
  scopeCoversCategory,
  type WritingScope,
} from '@/lib/scheduled/writing-scope';

/** The pairs live in the private templates; the tests use a made-up one */
const SCOPE: WritingScope = [{ category: 'exhibition', operator: 'ltr' }];

describe('operatorFromProfile', () => {
  it('reads every known site structure as LTR (ltr and hivelocity are both sites run by LTR)', () => {
    expect(operatorFromProfile('ltr')).toBe('ltr');
    expect(operatorFromProfile('hivelocity')).toBe('ltr');
  });

  it('does not guess when no known structure matched', () => {
    expect(operatorFromProfile(null)).toBe('unknown');
  });
});

describe('judgeWritingScope', () => {
  it('writes a pair in the scope', () => {
    expect(judgeWritingScope('exhibition', 'ltr', SCOPE)).toEqual({
      category: 'exhibition',
      operator: 'ltr',
      inScope: true,
    });
  });

  it('skips a pair whose operator is unknown, and says why', () => {
    const verdict = judgeWritingScope('exhibition', 'unknown', SCOPE);
    expect(verdict.inScope).toBe(false);
    expect(verdict.reason).toBe('書く対象の外 (種別 exhibition / 運営 運営不明)');
  });

  it.each(['collabo-cafe', 'pop-up-store', 'chain-store', 'other'] as const)(
    'skips %s when the scope does not list it',
    category => {
      const verdict = judgeWritingScope(category, 'ltr', SCOPE);
      expect(verdict.inScope).toBe(false);
      expect(verdict.reason).toBe(`書く対象の外 (種別 ${category} / 運営 LTR)`);
    }
  );

  it('writes nothing with an empty scope', () => {
    expect(judgeWritingScope('exhibition', 'ltr', []).inScope).toBe(false);
  });
});

describe('describeWritingScope', () => {
  it('reads as a line for the CLI and logs', () => {
    expect(describeWritingScope(judgeWritingScope('exhibition', 'ltr', SCOPE))).toBe(
      '書く (種別 exhibition / 運営 LTR)'
    );
    expect(describeWritingScope(judgeWritingScope('chain-store', 'unknown', SCOPE))).toBe(
      'スキップ: 書く対象の外 (種別 chain-store / 運営 運営不明)'
    );
  });
});

describe('scopeCoversCategory', () => {
  it('is true for a kind that some operator makes writable', () => {
    expect(scopeCoversCategory('exhibition', SCOPE)).toBe(true);
    expect(scopeCoversCategory('pop-up-store', SCOPE)).toBe(false);
  });
});

describe('parseWritingScope', () => {
  it('reads the pairs', () => {
    expect(
      parseWritingScope('writing_scope:\n  - category: exhibition\n    operator: ltr\n')
    ).toEqual(SCOPE);
  });

  it.each([
    ['a kind outside the five', 'writing_scope:\n  - category: goods-sales\n    operator: ltr\n'],
    ['an unknown operator', 'writing_scope:\n  - category: exhibition\n    operator: animate\n'],
    [
      'an unknown key',
      'writing_scope:\n  - category: exhibition\n    operator: ltr\n    note: x\n',
    ],
    ['no writing_scope', 'other: 1\n'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseWritingScope(text)).toThrow();
  });
});

describe('loadWritingScope', () => {
  it('fails when the file is missing (a scheduled run cannot tell what to write)', () => {
    expect(() => loadWritingScope('/nonexistent/writing-scope.yaml')).toThrow('missing');
  });

  it('reads a file and names it when it is malformed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writing-scope-'));
    try {
      const file = path.join(dir, 'writing-scope.yaml');
      fs.writeFileSync(file, 'writing_scope:\n  - category: exhibition\n    operator: ltr\n');
      expect(loadWritingScope(file)).toEqual(SCOPE);
      fs.writeFileSync(file, 'writing_scope: 1\n');
      expect(() => loadWritingScope(file)).toThrow(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
