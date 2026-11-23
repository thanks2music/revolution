/**
 * cron の検証。Functions と同じ cron-parser (v5)・同じタイムゾーンで読むことと、
 * 「cron の発火時刻」ではなく「見回り (毎時 05 分) で実際に見に行く時刻」を返すことを確かめる。
 */

import { validateCron } from '@/lib/target/cron';

describe('validateCron', () => {
  it('accepts the default hourly cron and reports the next check', async () => {
    const result = await validateCron('0 * * * *');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextCheckAt).toBeInstanceOf(Date);
    }
  });

  it.each([
    ['every three hours', '0 */3 * * *'],
    ['weekdays at 9', '0 9 * * 1-5'],
    ['weekly on monday', '0 9 * * 1'],
    ['six fields with seconds', '0 0 9 * * *'],
  ])('accepts %s', async (_label, expression) => {
    await expect(validateCron(expression)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['an out-of-range hour', '0 25 * * *'],
    ['gibberish', 'not a cron'],
    ['an out-of-range minute', '61 * * * *'],
  ])('rejects %s', async (_label, expression) => {
    await expect(validateCron(expression)).resolves.toMatchObject({ ok: false });
  });

  it('rejects an empty expression with a user-facing message', async () => {
    const result = await validateCron('   ');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('頻度を入力してください');
    }
  });

  it('reports the dispatch tick, not the raw cron fire time', async () => {
    // cron は毎時 00 分を指すが、見回りは毎時 05 分にしか動かない
    const result = await validateCron('0 * * * *');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextCheckAt.getMinutes()).toBe(5);
      expect(result.nextCheckAt.getSeconds()).toBe(0);
    }
  });

  it('pushes a late-in-the-hour cron to the following tick', async () => {
    // 30 分を指す cron は、その時間の :05 を過ぎているので、次の時間の :05 になる
    const result = await validateCron('30 * * * *');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextCheckAt.getMinutes()).toBe(5);
    }
  });

  it('evaluates in Asia/Tokyo, matching the Functions', async () => {
    // JST 09:00 の発火 → 見に行くのは JST 09:05 = UTC 00:05
    const result = await validateCron('0 9 * * *');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextCheckAt.getUTCHours()).toBe(0);
      expect(result.nextCheckAt.getUTCMinutes()).toBe(5);
    }
  });
});
