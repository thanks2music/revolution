import { describe, it, expect } from '@jest/globals';

import {
  isOnboardedFromMetadata,
  isOnboardedFromClaims,
} from '@/lib/auth/onboarding-status';

/**
 * Layer1: onboarding 完了判定 (純粋関数)。案B の JWT claims 判定の心臓部。
 * middleware の保護リダイレクト挙動の正しさはこの関数の正しさに依存する。
 */
describe('isOnboardedFromMetadata', () => {
  it('returns true only for strict boolean true', () => {
    expect(isOnboardedFromMetadata({ onboarded: true })).toBe(true);
  });

  it('returns false when onboarded is false', () => {
    expect(isOnboardedFromMetadata({ onboarded: false })).toBe(false);
  });

  it('returns false when onboarded is missing', () => {
    expect(isOnboardedFromMetadata({})).toBe(false);
    expect(isOnboardedFromMetadata({ email: 'a@b.com' })).toBe(false);
  });

  it('does not treat truthy non-boolean as onboarded (no coercion)', () => {
    expect(isOnboardedFromMetadata({ onboarded: 'true' })).toBe(false);
    expect(isOnboardedFromMetadata({ onboarded: 1 })).toBe(false);
  });

  it('returns false for null/undefined metadata', () => {
    expect(isOnboardedFromMetadata(null)).toBe(false);
    expect(isOnboardedFromMetadata(undefined)).toBe(false);
  });
});

describe('isOnboardedFromClaims', () => {
  it('returns false for unauthenticated (null/undefined claims)', () => {
    expect(isOnboardedFromClaims(null)).toBe(false);
    expect(isOnboardedFromClaims(undefined)).toBe(false);
  });

  it('returns false when authenticated but user_metadata lacks onboarded', () => {
    expect(isOnboardedFromClaims({ user_metadata: {} })).toBe(false);
    expect(isOnboardedFromClaims({ user_metadata: null })).toBe(false);
    expect(isOnboardedFromClaims({})).toBe(false);
  });

  it('returns true when user_metadata.onboarded === true', () => {
    expect(isOnboardedFromClaims({ user_metadata: { onboarded: true } })).toBe(
      true,
    );
  });
});
