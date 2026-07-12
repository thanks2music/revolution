/**
 * Layer 1 tests for parseFrontmatter() — event_data nested YAML propagation.
 *
 * Sprint C-α (MVP §11) で追加された event_data 伝搬 fix の regression guard。
 * claude[bot] コメント #2 / #3 が独立指摘した「generate-article-index.ts の 1 行
 * regex parser が nested YAML の event_data を読めない」問題への Layer 1 検証。
 *
 * 既存の実行系統合 test (generate-article-index.test.ts) は execSync で実際の MDX
 * ディレクトリを parse するため event_data 個別ケースを網羅できない。本 file は
 * parseFrontmatter を直接呼び出し、YAML 入力パターンを網羅的に検証する。
 */

import { describe, it, expect } from '@jest/globals';
import { parseFrontmatter } from '../../../lib/mdx/parse-frontmatter';

const buildContent = (frontmatterBody: string): string =>
  `---\n${frontmatterBody}\n---\n\n# Body\n`;

const REQUIRED_FLAT = [
  'post_id: "01H8XYZ0000000000000000000"',
  'year: 2026',
  'event_type: collabo-cafe',
  'event_title: コラボカフェ',
  'work_title: らんま1/2',
  'work_slug: ranma',
  'slug: sample-slug',
  'title: Sample Title',
  'date: "2026-07-13T00:00:00.000Z"',
].join('\n');

describe('parseFrontmatter — event_data nested YAML propagation (Sprint C-α)', () => {
  it('event_data 未定義時は frontmatter.event_data が undefined を返す (regression guard)', () => {
    const content = buildContent(REQUIRED_FLAT);
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    expect((fm as { event_data?: unknown }).event_data).toBeUndefined();
  });

  it('単純 event_data (title_slugs + venues) を nested YAML から parse できる', () => {
    const content = buildContent(
      `${REQUIRED_FLAT}\nevent_data:\n  title_slugs:\n    - ranma\n  venues:\n    - shibuya-parco`
    );
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    const ed = (fm as { event_data?: { title_slugs?: string[]; venues?: string[] } }).event_data;
    expect(ed).toBeDefined();
    expect(ed?.title_slugs).toEqual(['ranma']);
    expect(ed?.venues).toEqual(['shibuya-parco']);
  });

  it('event_data.occurrences[] の nested 配列を parse できる (Q4=C mapping の基盤)', () => {
    const content = buildContent(
      `${REQUIRED_FLAT}\nevent_data:\n  title_slugs:\n    - ranma\n  occurrences:\n    - starts_on: "2026-07-01"\n      ends_on: "2026-08-31"\n      venue_slug: shibuya-parco\n      official_url: "https://example.com/ranma"`
    );
    const fm = parseFrontmatter(content);
    const ed = (fm as {
      event_data?: {
        occurrences?: Array<{
          starts_on?: string;
          ends_on?: string;
          venue_slug?: string;
          official_url?: string;
        }>;
      };
    }).event_data;
    expect(ed).toBeDefined();
    expect(ed?.occurrences).toHaveLength(1);
    expect(ed?.occurrences?.[0]).toEqual({
      starts_on: '2026-07-01',
      ends_on: '2026-08-31',
      venue_slug: 'shibuya-parco',
      official_url: 'https://example.com/ranma',
    });
  });

  it('event_data と既存 flat field (event_start_date 等) が併存できる (Q4=C 上位フィールド維持)', () => {
    const content = buildContent(
      `${REQUIRED_FLAT}\nevent_start_date: "2026-07-01"\nevent_end_date: "2026-08-31"\nvenue: 渋谷パルコ\nofficial_url: "https://example.com/ranma"\nevent_data:\n  title_slugs:\n    - ranma\n  occurrences:\n    - starts_on: "2026-07-01"\n      ends_on: "2026-08-31"`
    );
    const fm = parseFrontmatter(content);
    expect((fm as { event_start_date?: string }).event_start_date).toBe('2026-07-01');
    expect((fm as { event_end_date?: string }).event_end_date).toBe('2026-08-31');
    expect((fm as { venue?: string }).venue).toBe('渋谷パルコ');
    expect((fm as { official_url?: string }).official_url).toBe('https://example.com/ranma');
    const ed = (fm as { event_data?: { title_slugs?: string[] } }).event_data;
    expect(ed?.title_slugs).toEqual(['ranma']);
  });

  it('不正な nested YAML (interpretable でない) は silent skip して既存 flat field を破壊しない', () => {
    // js-yaml が interpret できない構造でも、`key1: value1` の flat field 解析は正常に動く
    const content = buildContent(
      `${REQUIRED_FLAT}\nevent_data:\n  title_slugs: [\n    "unterminated array\n  extra: "still parsed"`
    );
    const fm = parseFrontmatter(content);
    expect(fm).not.toBeNull();
    // 既存 flat field は影響を受けない
    expect((fm as { post_id?: string }).post_id).toBe('01H8XYZ0000000000000000000');
    expect((fm as { slug?: string }).slug).toBe('sample-slug');
  });
});
