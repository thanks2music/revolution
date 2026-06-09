import { describe, it, expect } from '@jest/globals';

import {
  UsernameSchema,
  ProfileUpdateSchema,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_REGEX,
} from '@revolution/schemas/profile';

/**
 * Layer1: username バリデーション (zod 真実源)。
 * frontend が @revolution/schemas をまたいで import できること + バリデーション
 * 仕様 (3-24 文字 / ^[a-zA-Z0-9_]+$ / case 保持) の契約をテストする。三段防御の
 * Layer1 部分 (zod) を保証し、DB CHECK と lower() unique index は M1 で SQL 実証済み。
 */
describe('UsernameSchema (Layer1, zod 真実源)', () => {
  it('accepts valid usernames (alnum + underscore, 3-24 chars)', () => {
    for (const u of ['abc', 'anime_taro', 'A1_b2', 'x'.repeat(USERNAME_MAX_LENGTH)]) {
      expect(UsernameSchema.safeParse(u).success).toBe(true);
    }
  });

  it('rejects too short (< min)', () => {
    expect(UsernameSchema.safeParse('ab').success).toBe(false);
    expect(USERNAME_MIN_LENGTH).toBe(3);
  });

  it('rejects too long (> max)', () => {
    expect(UsernameSchema.safeParse('x'.repeat(USERNAME_MAX_LENGTH + 1)).success).toBe(
      false,
    );
    expect(USERNAME_MAX_LENGTH).toBe(24);
  });

  it('rejects invalid characters (symbols, spaces, hyphen, japanese)', () => {
    for (const u of ['bad!name', 'has space', 'kebab-case', 'にほんご', 'dot.dot', 'emoji😀x']) {
      expect(UsernameSchema.safeParse(u).success).toBe(false);
    }
  });

  it('regex matches the DB CHECK pattern exactly', () => {
    // DB CHECK: username ~ '^[a-zA-Z0-9_]{3,24}$'
    expect(USERNAME_REGEX.source).toBe('^[a-zA-Z0-9_]{3,24}$');
    expect(USERNAME_REGEX.test('valid_99')).toBe(true);
    expect(USERNAME_REGEX.test('no')).toBe(false);
  });

  it('preserves case (does not lowercase the value)', () => {
    const parsed = UsernameSchema.safeParse('MixedCase_99');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('MixedCase_99');
  });
});

describe('ProfileUpdateSchema (onboarding 入力契約)', () => {
  it('accepts a valid username + displayName pair', () => {
    const r = ProfileUpdateSchema.safeParse({
      username: 'anime_taro',
      displayName: 'あにめ太郎',
    });
    expect(r.success).toBe(true);
  });

  it('reports the username path on invalid username', () => {
    const r = ProfileUpdateSchema.safeParse({
      username: 'bad name',
      displayName: 'ok',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'username')).toBe(true);
    }
  });

  it('rejects empty displayName', () => {
    const r = ProfileUpdateSchema.safeParse({
      username: 'anime_taro',
      displayName: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'displayName')).toBe(true);
    }
  });
});
