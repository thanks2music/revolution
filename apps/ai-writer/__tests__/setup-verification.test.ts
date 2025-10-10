/**
 * テスト環境セットアップ確認テスト
 */

import { describe, it, expect } from '@jest/globals';

describe('Test Environment Verification', () => {
  it('should have test environment configured', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('should have Firebase Emulator environment variables', () => {
    expect(process.env.FIREBASE_USE_EMULATOR).toBe('true');
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('localhost:8088');
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('localhost:9099');
  });

  it('should have test API keys configured', () => {
    expect(process.env.CLAUDE_API_KEY).toBe('test-dummy-claude-api-key');
    expect(process.env.WORDPRESS_AUTH_TOKEN).toBe('test-dummy-wordpress-token');
  });

  it('should have mocked fetch function', () => {
    expect(global.fetch).toBeDefined();
    expect(typeof global.fetch).toBe('function');
  });

  it('should have TextEncoder and TextDecoder', () => {
    expect(global.TextEncoder).toBeDefined();
    expect(global.TextDecoder).toBeDefined();
  });
});