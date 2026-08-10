import { describe, expect, it } from '@jest/globals';

import { resolveEventTypeHeadingLabel } from '@/lib/utils/event-type-heading-label';

/**
 * 種別 → 見出し表記の解決 (S1-d Phase 3、2026-08-09)
 *
 * 代表会場名が決まらない多ブランド開催では H2 が
 * `## {作品名} {種別} in {都市}` の形になり、その {種別} を引くのが本モジュール。
 *
 * ★ **「カフェ」を既定値にしてはならない。** テイクアウトのみの企画や原画展を
 *   「カフェ」と呼ぶことになる (`revolution-article-meta.md` §4.3 と同趣旨)。
 *   モジュール自身がその点を doc コメントで警告しているため、
 *   フォールバック挙動を直接固定する (claude[bot] 指摘でテスト欠落が判明)。
 *
 * fixture は実辞書 (`event-type-slugs.yaml`) に実在する値の写し。
 */

const EVENT_TYPES: Record<string, string> = {
  コラボカフェ: 'collabo-cafe',
  カフェコラボ: 'collabo-cafe',
  期間限定カフェ: 'collabo-cafe',
  ポップアップストア: 'pop-up-store',
  原画展: 'exhibition',
};

const HEADING_LABELS: Record<string, string> = {
  'collabo-cafe': 'カフェ',
};

describe('resolveEventTypeHeadingLabel', () => {
  describe('slug 経由で見出し表記に解決する', () => {
    it('コラボカフェ → カフェ', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: 'コラボカフェ',
          eventTypes: EVENT_TYPES,
          headingLabels: HEADING_LABELS,
        })
      ).toBe('カフェ');
    });

    it('別名でも同じ slug 経由で解決する (多対一)', () => {
      // event_types は多対一。だからこそ slug からの逆引きでは代用できず、
      // heading_labels を別表として持っている。
      for (const name of ['カフェコラボ', '期間限定カフェ']) {
        expect(
          resolveEventTypeHeadingLabel({
            eventTypeName: name,
            eventTypes: EVENT_TYPES,
            headingLabels: HEADING_LABELS,
          })
        ).toBe('カフェ');
      }
    });
  });

  describe('★「カフェ」を既定値にしない', () => {
    it('heading_labels に無い slug は抽出された種別名をそのまま返す', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: 'ポップアップストア',
          eventTypes: EVENT_TYPES,
          headingLabels: HEADING_LABELS,
        })
      ).toBe('ポップアップストア');
    });

    it('原画展を「カフェ」と呼ばない', () => {
      const r = resolveEventTypeHeadingLabel({
        eventTypeName: '原画展',
        eventTypes: EVENT_TYPES,
        headingLabels: HEADING_LABELS,
      });

      expect(r).toBe('原画展');
      expect(r).not.toBe('カフェ');
    });

    it('heading_labels 自体が未定義でも種別名を返す', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: 'ポップアップストア',
          eventTypes: EVENT_TYPES,
        })
      ).toBe('ポップアップストア');
    });
  });

  describe('辞書に無い種別', () => {
    it('event_types に無い種別名はそのまま返す', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: '謎の新イベント種別',
          eventTypes: EVENT_TYPES,
          headingLabels: HEADING_LABELS,
        })
      ).toBe('謎の新イベント種別');
    });

    it('eventTypes 自体が未定義でも種別名を返す', () => {
      expect(resolveEventTypeHeadingLabel({ eventTypeName: 'コラボカフェ' })).toBe('コラボカフェ');
    });
  });

  describe('境界', () => {
    it('種別名が空なら空文字を返す (throw しない)', () => {
      expect(resolveEventTypeHeadingLabel({ eventTypeName: '' })).toBe('');
      expect(resolveEventTypeHeadingLabel({})).toBe('');
      expect(resolveEventTypeHeadingLabel({ eventTypeName: null })).toBe('');
    });

    it('前後の空白を無視する', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: '  コラボカフェ  ',
          eventTypes: EVENT_TYPES,
          headingLabels: HEADING_LABELS,
        })
      ).toBe('カフェ');
    });

    it('heading_labels の値が空白だけなら種別名へフォールバックする', () => {
      expect(
        resolveEventTypeHeadingLabel({
          eventTypeName: 'コラボカフェ',
          eventTypes: EVENT_TYPES,
          headingLabels: { 'collabo-cafe': '   ' },
        })
      ).toBe('コラボカフェ');
    });
  });
});
