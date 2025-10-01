/**
 * Jest設定の動作確認テスト
 */

describe('Jest Setup', () => {
  it('should work with basic assertions', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to environment variables', () => {
    // Next.js 環境変数がロードされているか確認
    expect(process.env.NODE_ENV).toBeDefined();
  });

  it('should support TypeScript', () => {
    const message: string = 'TypeScript works!';
    expect(message).toBe('TypeScript works!');
  });

  it('should support async/await', async () => {
    const promise = Promise.resolve('async works');
    const result = await promise;
    expect(result).toBe('async works');
  });
});