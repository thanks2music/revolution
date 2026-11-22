jest.mock('@/actions/review-photos', () => ({}));

import { MAX_REVIEW_PHOTO_BYTES } from '@revolution/schemas/review-photo';

import {
  photoTypeOf,
  screenSelectedPhotos,
} from '@/components/molecules/reviews/ReviewPhotosField';

/** 写真の欄が、選んだその場で断る理由 (one-more-time #163) */
describe('photoTypeOf', () => {
  it('ブラウザが付けた形式を使い、付かない HEIC (Windows など) は拡張子で見分ける', () => {
    expect(photoTypeOf({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg');
    expect(photoTypeOf({ name: 'IMG_1.HEIC', type: '' })).toBe('image/heic');
    expect(photoTypeOf({ name: 'b.heif', type: 'application/octet-stream' })).toBe('image/heic');
    expect(photoTypeOf({ name: 'c.png', type: '' })).toBe('image/png');
    expect(photoTypeOf({ name: 'd.gif', type: 'image/gif' })).toBeNull();
    // 形式が付いていて違う物は、拡張子で救わない
    expect(photoTypeOf({ name: 'e.jpg', type: 'image/gif' })).toBeNull();
  });
});

describe('screenSelectedPhotos', () => {
  it('形式・10MB を超える物・入らない枚数を、名前つきの理由で断る', () => {
    const files = [
      { name: 'ok1.jpg', type: 'image/jpeg', size: 100 },
      { name: 'big.jpg', type: 'image/jpeg', size: MAX_REVIEW_PHOTO_BYTES + 1 },
      { name: 'anim.gif', type: 'image/gif', size: 100 },
      { name: 'ok2.heic', type: '', size: 100 },
      { name: 'ok3.png', type: 'image/png', size: 100 },
    ];

    const result = screenSelectedPhotos(files, 2);

    expect(result.accepted).toEqual([
      { index: 0, type: 'image/jpeg' },
      { index: 3, type: 'image/heic' },
    ]);
    expect(result.errors).toEqual([
      'big.jpg: 10MB を超えています',
      'anim.gif: JPEG・PNG・HEIC の写真を選んでください',
      '写真は 10 枚までです。入らなかった写真は付けていません',
    ]);
  });
});
