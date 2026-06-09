/**
 * Layer1: provider 判定 (hasEmail / hasGoogle / canChangeEmail)
 *
 * Supabase User の identities 配列から provider を判定する純粋関数。
 * マイページの「メール変更はメール登録のみ可、Google 不可」制御の真実源。
 */

import { canChangeEmail, hasEmail, hasGoogle } from '@/lib/auth/provider';

describe('hasEmail', () => {
  it('is true when an email identity exists', () => {
    expect(hasEmail([{ provider: 'email' }])).toBe(true);
  });

  it('is true when email is one of several identities', () => {
    expect(hasEmail([{ provider: 'google' }, { provider: 'email' }])).toBe(true);
  });

  it('is false for a google-only user', () => {
    expect(hasEmail([{ provider: 'google' }])).toBe(false);
  });

  it('is false for null/undefined/empty', () => {
    expect(hasEmail(null)).toBe(false);
    expect(hasEmail(undefined)).toBe(false);
    expect(hasEmail([])).toBe(false);
  });
});

describe('hasGoogle', () => {
  it('is true when a google identity exists', () => {
    expect(hasGoogle([{ provider: 'google' }])).toBe(true);
  });

  it('is true when google is one of several identities', () => {
    expect(hasGoogle([{ provider: 'email' }, { provider: 'google' }])).toBe(true);
  });

  it('is false for an email-only user', () => {
    expect(hasGoogle([{ provider: 'email' }])).toBe(false);
  });

  it('is false for null/undefined/empty', () => {
    expect(hasGoogle(null)).toBe(false);
    expect(hasGoogle(undefined)).toBe(false);
    expect(hasGoogle([])).toBe(false);
  });
});

describe('canChangeEmail', () => {
  it('allows email change for an email-registered user', () => {
    expect(canChangeEmail([{ provider: 'email' }])).toBe(true);
  });

  it('forbids email change for a google-only user', () => {
    expect(canChangeEmail([{ provider: 'google' }])).toBe(false);
  });

  it('allows email change for an email + google user (has email identity)', () => {
    expect(canChangeEmail([{ provider: 'email' }, { provider: 'google' }])).toBe(true);
  });

  it('forbids when there are no identities', () => {
    expect(canChangeEmail(null)).toBe(false);
    expect(canChangeEmail([])).toBe(false);
  });
});
