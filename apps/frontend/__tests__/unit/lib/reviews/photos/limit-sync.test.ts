/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MAX_REVIEW_PHOTOS } from '@revolution/schemas/review-photo';

import { MAX_PHOTOS_MESSAGE } from '@/lib/reviews/photos/operations';

jest.mock('@/lib/env', () => ({ env: {} }));

/**
 * 10 枚の上限は、DB のトリガ (migration) と TS の定数の 2 か所にある。片方だけを変えると、
 * 画面の案内と DB の止め方が食い違うので、ここで揃っていることを確かめる (one-more-time #163)
 */
describe('写真の枚数の上限', () => {
  const migration = readFileSync(
    path.join(__dirname, '../../../../../supabase/migrations/20261122081202_review_photos.sql'),
    'utf8'
  );

  it('トリガの上限と、投げる文が TS の定数と同じ', () => {
    expect(migration).toContain(
      `WHERE "review_id" = NEW."review_id") >= ${MAX_REVIEW_PHOTOS} THEN`
    );
    expect(migration).toContain(`RAISE EXCEPTION '${MAX_PHOTOS_MESSAGE}'`);
  });
});
