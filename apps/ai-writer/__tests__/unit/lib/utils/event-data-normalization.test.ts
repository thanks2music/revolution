/**
 * `parseAndNormalizeEventData` の Layer 1 テスト。
 *
 * この関数は**パイプライン / 会場の網羅性ゲート / 照合 CLI の 3 者が通る唯一の経路**
 * なので、「測れなかった」と「0 件だった」の区別がここで崩れると 3 箇所同時に壊れる。
 */

import { describe, expect, it } from '@jest/globals';

import { parseAndNormalizeEventData } from '@/lib/utils/event-data-normalization';

const PERIOD = {
  開始: { 年: '2026年', 日付: '5月14日' },
  終了: { 年: '2026年', 日付: '7月5日', 未定: false },
};

function occurrence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue_slug: null,
    venue_label: 'A店',
    starts_on: null,
    ends_on: null,
    official_url: null,
    ...overrides,
  };
}

function eventData(occurrences: unknown[]): Record<string, unknown> {
  return { primary_category_slug: 'collabo-cafe', title_slugs: ['test-work'], occurrences };
}

describe('parseAndNormalizeEventData', () => {
  it('event_data キーが無い場合は absent (0 件と区別する)', () => {
    expect(parseAndNormalizeEventData({ rawEventData: undefined })).toEqual({ status: 'absent' });
  });

  it('schema 不適合は invalid を返し、空配列に潰さない', () => {
    // `primary_category_slug` / `title_slugs` (必須) を欠く
    const result = parseAndNormalizeEventData({ rawEventData: { occurrences: [] } });

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('unreachable');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('occurrences が空でも ok (測れた上で 0 件は正当)', () => {
    const result = parseAndNormalizeEventData({ rawEventData: eventData([]) });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.occurrences).toEqual([]);
  });

  it('連結された会場名を分割し、警告を返す (ログは呼び出し側が出す)', () => {
    const result = parseAndNormalizeEventData({
      rawEventData: eventData([occurrence({ venue_label: 'A店、B店、C店' })]),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.occurrences.map((o) => o.venue_label)).toEqual(['A店', 'B店', 'C店']);
    expect(result.warnings.some((w) => w.includes('分割'))).toBe(true);
  });

  it('開催期間から欠落した日付を補完する', () => {
    const result = parseAndNormalizeEventData({
      rawEventData: eventData([occurrence()]),
      period: PERIOD,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.occurrences[0]).toMatchObject({
      starts_on: '2026-05-14',
      ends_on: '2026-07-05',
    });
  });

  // ⚠️ 終了日が「未定」なのは事実。開始日等で埋めると
  //    **測れなかったものを測れたことにする**。
  it('終了日が未定なら ends_on を埋めない', () => {
    const result = parseAndNormalizeEventData({
      rawEventData: eventData([occurrence()]),
      period: { ...PERIOD, 終了: { 年: null, 日付: null, 未定: true } },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.occurrences[0].starts_on).toBe('2026-05-14');
    expect(result.occurrences[0].ends_on).toBeNull();
  });

  it('期間を渡さなくても落ちない (CLI が 開催期間 を持たない応答を読む場合)', () => {
    const result = parseAndNormalizeEventData({ rawEventData: eventData([occurrence()]) });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.occurrences[0].starts_on).toBeNull();
  });

  // ★ ゲート (detail-extraction 時点、prefectures 未解決) と後段の lead-generation
  //   (解決済み prefectures) が**同じ occurrences** を得ることを固定する。
  //   ここが崩れると「ゲートは通ったのに記事は別の occurrences」が起きる。
  it('prefectures の有無で occurrences は変わらない (warn だけが増える)', () => {
    const raw = eventData([occurrence({ venue_label: 'A店' })]);

    const withoutPrefectures = parseAndNormalizeEventData({ rawEventData: raw });
    const withPrefectures = parseAndNormalizeEventData({
      rawEventData: raw,
      prefectures: ['東京都', '大阪府', '愛知県'],
    });

    expect(withoutPrefectures.status).toBe('ok');
    expect(withPrefectures.status).toBe('ok');
    if (withoutPrefectures.status !== 'ok' || withPrefectures.status !== 'ok') {
      throw new Error('unreachable');
    }
    expect(withPrefectures.occurrences).toEqual(withoutPrefectures.occurrences);
    // 会場数 < 都道府県数 の cross-check 警告が増えるだけ
    expect(withPrefectures.warnings.length).toBeGreaterThan(withoutPrefectures.warnings.length);
  });
});
