import {
  SendMessageResultSchema,
  TokenUsageSchema,
  type SendMessageResult,
  type TokenUsage,
} from '../../../../../../shared/schemas/ai-provider-response';

describe('TokenUsageSchema', () => {
  describe('正常系', () => {
    it('全フィールド整数値で成功', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      expect(result.success).toBe(true);
    });

    it('全 0 でも成功 (nonnegative)', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('異常系', () => {
    it('promptTokens が負だと失敗', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: -1,
        completionTokens: 50,
        totalTokens: 150,
      });
      expect(result.success).toBe(false);
    });

    it('completionTokens が負だと失敗', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: 100,
        completionTokens: -1,
        totalTokens: 150,
      });
      expect(result.success).toBe(false);
    });

    it('totalTokens が負だと失敗', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: -1,
      });
      expect(result.success).toBe(false);
    });

    it('小数値だと失敗 (z.number().int())', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: 100.5,
        completionTokens: 50,
        totalTokens: 150,
      });
      expect(result.success).toBe(false);
    });

    it('promptTokens が欠けると失敗', () => {
      const result = TokenUsageSchema.safeParse({
        completionTokens: 50,
        totalTokens: 150,
      });
      expect(result.success).toBe(false);
    });

    it('文字列の数値だと失敗', () => {
      const result = TokenUsageSchema.safeParse({
        promptTokens: '100',
        completionTokens: 50,
        totalTokens: 150,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('SendMessageResultSchema', () => {
  describe('正常系', () => {
    it('usage なしで成功 (Anthropic typical: { content, model })', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello, world',
        model: 'claude-sonnet-4-6',
      });
      expect(result.success).toBe(true);
    });

    it('usage 付きで成功 (Anthropic typical with usage)', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello, world',
        model: 'claude-sonnet-4-6',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });
      expect(result.success).toBe(true);
    });

    it('Gemini typical mock value で成功', () => {
      const result = SendMessageResultSchema.safeParse({
        content: '{"workTitle": "test"}',
        model: 'gemini-2.5-flash-lite',
        usage: {
          promptTokens: 80,
          completionTokens: 20,
          totalTokens: 100,
        },
      });
      expect(result.success).toBe(true);
    });

    it('OpenAI typical mock value で成功', () => {
      const result = SendMessageResultSchema.safeParse({
        content: '{"result": "ok"}',
        model: 'gpt-4.1-mini',
        usage: {
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
      });
      expect(result.success).toBe(true);
    });

    it('content が空文字でも成功 (min 制約なし)', () => {
      const result = SendMessageResultSchema.safeParse({
        content: '',
        model: 'claude-sonnet-4-6',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('MUST フィールド欠落で失敗', () => {
    it('content が欠けると失敗', () => {
      const result = SendMessageResultSchema.safeParse({
        model: 'claude-sonnet-4-6',
      });
      expect(result.success).toBe(false);
    });

    it('model が欠けると失敗', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('usage の部分付与', () => {
    it('usage が部分的 (promptTokens のみ) だと失敗', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello',
        model: 'claude-sonnet-4-6',
        usage: {
          promptTokens: 100,
        },
      });
      expect(result.success).toBe(false);
    });

    it('usage が空オブジェクトだと失敗 (3 フィールド required)', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello',
        model: 'claude-sonnet-4-6',
        usage: {},
      });
      expect(result.success).toBe(false);
    });

    it('usage が undefined だと成功 (optional)', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello',
        model: 'claude-sonnet-4-6',
        usage: undefined,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('型不一致', () => {
    it('content が数値だと失敗', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 123,
        model: 'claude-sonnet-4-6',
      });
      expect(result.success).toBe(false);
    });

    it('model が null だと失敗', () => {
      const result = SendMessageResultSchema.safeParse({
        content: 'Hello',
        model: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('z.infer で型が正しく派生する', () => {
    it('SendMessageResult 型として代入できる', () => {
      const x: SendMessageResult = {
        content: 'Hello',
        model: 'claude-sonnet-4-6',
      };
      expect(x.content).toBe('Hello');
      expect(x.usage).toBeUndefined();
    });

    it('TokenUsage 型として代入できる', () => {
      const u: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };
      expect(u.totalTokens).toBe(150);
    });

    it('SendMessageResult.usage は TokenUsage 互換型', () => {
      const usage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };
      const result: SendMessageResult = {
        content: 'Hello',
        model: 'claude-sonnet-4-6',
        usage,
      };
      expect(result.usage?.totalTokens).toBe(150);
    });
  });
});
