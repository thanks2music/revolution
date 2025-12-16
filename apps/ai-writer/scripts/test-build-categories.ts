/**
 * buildCategories() 関数の動作確認テスト
 *
 * @description
 * taxonomy.yaml v1.1 の category_rules に従った決定論的カテゴリ生成をテスト
 * - categories は work_title + event_title の2件固定
 * - prefectures は categories に含めず、別フィールドで管理
 *
 * @usage
 * cd apps/ai-writer && pnpm tsx scripts/test-build-categories.ts
 */

// buildCategories 関数のコピー（テスト用）
// taxonomy.yaml v1.1 準拠: 2件固定（work_title + event_title）
function buildCategories(params: {
  workTitle: string;
  eventTitle: string;
}): string[] {
  const categories: string[] = [];

  // Priority 1: 作品名（必須）
  if (params.workTitle) {
    categories.push(params.workTitle);
  }

  // Priority 2: イベント種別名（必須）
  if (params.eventTitle) {
    categories.push(params.eventTitle);
  }

  // 制約: 2件固定（taxonomy.yaml v1.1 constraints）
  // prefectures は別フィールドで管理するため、ここでは含めない
  return categories;
}

// テストケース
interface TestCase {
  name: string;
  input: {
    workTitle: string;
    eventTitle: string;
  };
  expected: string[];
}

const testCases: TestCase[] = [
  // 基本ケース
  {
    name: '基本ケース（呪術廻戦 × コラボカフェ）',
    input: {
      workTitle: '呪術廻戦',
      eventTitle: 'コラボカフェ',
    },
    expected: ['呪術廻戦', 'コラボカフェ'],
  },
  {
    name: '基本ケース（ブルーロック × ポップアップストア）',
    input: {
      workTitle: 'ブルーロック',
      eventTitle: 'ポップアップストア',
    },
    expected: ['ブルーロック', 'ポップアップストア'],
  },
  {
    name: '基本ケース（SPY×FAMILY × コラボカフェ）',
    input: {
      workTitle: 'SPY×FAMILY',
      eventTitle: 'コラボカフェ',
    },
    expected: ['SPY×FAMILY', 'コラボカフェ'],
  },
  {
    name: '基本ケース（ワンピース × 限定イベント）',
    input: {
      workTitle: 'ワンピース',
      eventTitle: '限定イベント',
    },
    expected: ['ワンピース', '限定イベント'],
  },
  // 空文字ケース（エッジケース）
  {
    name: 'workTitle が空文字の場合',
    input: {
      workTitle: '',
      eventTitle: 'コラボカフェ',
    },
    expected: ['コラボカフェ'],
  },
  {
    name: 'eventTitle が空文字の場合',
    input: {
      workTitle: '鬼滅の刃',
      eventTitle: '',
    },
    expected: ['鬼滅の刃'],
  },
];

// テスト実行
console.log('='.repeat(60));
console.log('buildCategories() テスト (taxonomy.yaml v1.1 準拠)');
console.log('='.repeat(60));
console.log('仕様: categories = [work_title, event_title] の2件固定');
console.log('      prefectures は別フィールドで管理');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = buildCategories(testCase.input);
  const isPass = JSON.stringify(result) === JSON.stringify(testCase.expected);

  if (isPass) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    console.log(`   入力: ${JSON.stringify(testCase.input)}`);
    console.log(`   期待: ${JSON.stringify(testCase.expected)}`);
    console.log(`   実際: ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`結果: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

// 失敗があれば exit code 1
if (failed > 0) {
  process.exit(1);
}
