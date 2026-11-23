import { publicMediaBaseUrl } from '@revolution/reviews/photos/public';

describe('publicMediaBaseUrl', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['  ', null],
    ['op://vault/item/field', null],
    ['https://img.example.test', 'https://img.example.test'],
    ['https://img.example.test/', 'https://img.example.test'],
  ])('%p → %p', (value, expected) => {
    expect(publicMediaBaseUrl(value)).toBe(expected);
  });
});
