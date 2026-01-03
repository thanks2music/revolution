/**
 * Test script for slug-resolver v2.0 (TitleEntry support)
 *
 * Usage:
 *   pnpm tsx apps/ai-writer/scripts/test-slug-resolver-v2.ts
 */
import {
  resolveWorkSlug,
  getEnglishTitle,
  findCanonicalTitle,
} from '../lib/config/slug-resolver';

async function runTests() {
  console.log('='.repeat(60));
  console.log('Slug Resolver v2.0 Test Suite');
  console.log('='.repeat(60));

  const testCases = [
    // 1. 直接マッチ（TitleEntry形式）
    {
      title: '進撃の巨人',
      expected: 'attack-on-titan',
      type: 'direct (TitleEntry)',
    },
    {
      title: '鬼滅の刃',
      expected: 'kimetsu-no-yaiba',
      type: 'direct (TitleEntry)',
    },
    {
      title: '機動戦士ガンダム 鉄血のオルフェンズ',
      expected: 'gundam-iron-blooded-orphans',
      type: 'direct (TitleEntry)',
    },

    // 2. 直接マッチ（シンプル形式 - 後方互換）
    { title: '真・侍伝 YAIBA', expected: 'yaiba', type: 'direct (simple)' },

    // 3. エイリアスマッチ
    { title: 'リゼロ', expected: 'rezero', type: 'alias' },
    { title: 'ぼざろ', expected: 'bocchi-the-rock', type: 'alias' },
    { title: '転スラ', expected: 'ten-sura', type: 'alias' },
    { title: 'ハルヒ', expected: 'haruhi', type: 'alias' },
  ];

  console.log('\n## resolveWorkSlug Tests\n');

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const result = await resolveWorkSlug(tc.title, false); // Disable fallback for testing
    const status = result === tc.expected ? '✅ PASS' : '❌ FAIL';
    const typeStr = tc.type.padEnd(20);
    console.log(
      `${status} | ${typeStr} | "${tc.title}" → "${result}" (expected: "${tc.expected}")`
    );
    if (result === tc.expected) passed++;
    else failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  // getEnglishTitle テスト
  console.log('\n## getEnglishTitle Tests\n');

  const englishTests = [
    { title: '進撃の巨人', expected: 'Attack on Titan' },
    { title: 'リゼロ', expected: 'Re:Zero - Starting Life in Another World' },
    { title: '真・侍伝 YAIBA', expected: null },
  ];

  for (const tc of englishTests) {
    const result = getEnglishTitle(tc.title);
    const status = result === tc.expected ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${status} | "${tc.title}" → "${result}" (expected: "${tc.expected}")`
    );
  }

  // findCanonicalTitle テスト
  console.log('\n## findCanonicalTitle Tests\n');

  const canonicalTests = [
    { alias: 'リゼロ', expected: 'Re:ゼロから始める異世界生活' },
    { alias: '進撃の巨人', expected: '進撃の巨人' },
    { alias: 'ぼざろ', expected: 'ぼっち・ざ・ろっく!' },
  ];

  for (const tc of canonicalTests) {
    const result = findCanonicalTitle(tc.alias);
    const status = result === tc.expected ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${status} | "${tc.alias}" → "${result}" (expected: "${tc.expected}")`
    );
  }

  console.log('\n' + '='.repeat(60));
}

runTests().catch(console.error);
