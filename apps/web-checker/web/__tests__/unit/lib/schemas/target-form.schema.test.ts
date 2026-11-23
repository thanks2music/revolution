/**
 * フォームの検証。rules と同じ条件で落ちること (片方だけ緩いと「フォームは通ったのに保存できない」)。
 */

import { targetFormSchema, validateTargetForm } from '@/lib/schemas/target-form.schema';

const valid = {
  title: 'サンプル公式サイト',
  url: 'https://example.com/news',
  selector: '#news',
  cron: '0 * * * *',
  notifyMode: 'slack' as const,
};

describe('targetFormSchema', () => {
  it('accepts a valid form', () => {
    expect(targetFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a non-https url, matching the rules', () => {
    expect(targetFormSchema.safeParse({ ...valid, url: 'http://example.com' }).success).toBe(false);
  });

  it('rejects a javascript: url', () => {
    expect(targetFormSchema.safeParse({ ...valid, url: 'javascript:alert(1)' }).success).toBe(
      false
    );
  });

  it('rejects a malformed url', () => {
    expect(targetFormSchema.safeParse({ ...valid, url: 'https://' }).success).toBe(false);
  });

  it.each([['title'], ['selector'], ['cron']])('rejects an empty %s', field => {
    expect(targetFormSchema.safeParse({ ...valid, [field]: '' }).success).toBe(false);
  });

  it('rejects fields as long as the rules forbid', () => {
    // rules は url < 2048、selector < 512、title < 200
    expect(targetFormSchema.safeParse({ ...valid, title: 'a'.repeat(200) }).success).toBe(false);
    expect(targetFormSchema.safeParse({ ...valid, title: 'a'.repeat(199) }).success).toBe(true);
    expect(targetFormSchema.safeParse({ ...valid, selector: 'a'.repeat(512) }).success).toBe(false);
    expect(
      targetFormSchema.safeParse({ ...valid, url: `https://example.com/${'a'.repeat(2048)}` })
        .success
    ).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    const result = targetFormSchema.safeParse({ ...valid, title: '  spaced  ' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('spaced');
    }
  });
});

describe('notifyMode', () => {
  it('accepts both modes', () => {
    expect(targetFormSchema.safeParse({ ...valid, notifyMode: 'ai-writer' }).success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(targetFormSchema.safeParse({ ...valid, notifyMode: 'email' }).success).toBe(false);
  });
});

describe('validateTargetForm', () => {
  it('returns one message per field', () => {
    const result = validateTargetForm({ ...valid, title: '', url: 'http://example.com' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBe('名前を入力してください');
      expect(result.errors.url).toBe('URL は https:// で始めてください');
      expect(result.errors.selector).toBeUndefined();
    }
  });
});
