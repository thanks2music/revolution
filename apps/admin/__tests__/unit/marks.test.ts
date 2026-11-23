import { describe, expect, it } from '@jest/globals';

import type { ModerationPhoto } from '@revolution/reviews/moderation';

import {
  initialMarks,
  missingReasonMessage,
  publishLabel,
  toPhotoDecisions,
  type PhotoMark,
} from '@/lib/moderation/marks';

const photo = (id: number, hiddenReason: ModerationPhoto['hiddenReason']): ModerationPhoto => ({
  id,
  hiddenReason,
  view: null,
});

describe('initialMarks', () => {
  it('AI が理由を付けた写真は非公開・AI の印で始まる。番号は並び順', () => {
    expect(initialMarks([photo(11, null), photo(12, 'personal_info')])).toEqual([
      { id: 11, number: 1, hide: false, reason: null, byAi: false },
      { id: 12, number: 2, hide: true, reason: 'personal_info', byAi: true },
    ]);
  });
});

describe('公開のボタンと理由の不足', () => {
  const marks: PhotoMark[] = [
    { id: 1, number: 1, hide: false, reason: null, byAi: false },
    { id: 2, number: 3, hide: true, reason: 'personal_info', byAi: true },
    { id: 3, number: 5, hide: true, reason: null, byAi: false },
  ];

  it('非公開の写真の番号をボタンに出す', () => {
    expect(publishLabel(marks)).toBe('写真 3・5 を非公開にして公開');
    expect(publishLabel([marks[0]])).toBe('公開する');
  });

  it('理由の無い非公開を知らせる', () => {
    expect(missingReasonMessage(marks)).toBe('写真 5 の理由を選んでください');
    expect(missingReasonMessage(marks.slice(0, 2))).toBeNull();
  });

  it('公開は理由が揃うまで送らない', () => {
    expect(toPhotoDecisions(marks, 'publish')).toBeNull();
    expect(toPhotoDecisions(marks.slice(0, 2), 'publish')).toEqual([
      { id: 1, hide: false },
      { id: 2, hide: true, reason: 'personal_info' },
    ]);
  });

  it('差し戻しは理由の無い非公開を「非公開にしない」で送る (写真は配信されない)', () => {
    expect(toPhotoDecisions(marks, 'reject')).toEqual([
      { id: 1, hide: false },
      { id: 2, hide: true, reason: 'personal_info' },
      { id: 3, hide: false },
    ]);
  });
});
