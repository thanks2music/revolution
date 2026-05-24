/**
 * Tests for scripts/seed-articles.ts (Sprint 5)
 *
 * Layer 戦略:
 *   - execSync で seed-articles.ts --dry-run --verbose を起動し、stdout から
 *     分布・post_id 命名・state 振り分け・MDX frontmatter を解析して assertion
 *   - generate-article-index.test.ts と同一パターン (子プロセス + stdout 解析)
 *   - 直接 import すると monorepo root の scripts/ を ai-writer 配下の jest config
 *     が拾えず複雑になるため、CLI 入出力契約として検証する Layer 2 寄り
 *
 * 検証項目:
 *   1. 分布計算 (50 件 → 15/15/15/5、その他 → 比例配分)
 *   2. post_id 命名規則 (seed-{state}-{NNN} prefix)
 *   3. work_slug 分散 (RelatedArticles の matchesWork 経路用)
 *   4. MDX frontmatter 構造 (4 状態でフィールド有無が正しく切り替わる)
 *   5. CLI フラグ (--count / --dry-run / --verbose)
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  renderMdx,
  generateSeedSpecs,
  calculateDistribution,
  type SeedArticle,
} from '../../../../scripts/seed-articles';

const REPO_ROOT = join(__dirname, '../../../..');

function runSeed(args: string): string {
  // REPO_ROOT に空白を含むパス (例: macOS の "/Users/John Doe/...") でも壊れないよう
  // 必ずダブルクォートで囲む。args は内部リテラルのみで外部入力なし。
  return execSync(
    `cd "${REPO_ROOT}" && npx tsx scripts/seed-articles.ts ${args}`,
    { encoding: 'utf-8' }
  );
}

describe('seed-articles.ts', () => {
  describe('CLI 起動と分布', () => {
    it('--count=50 --dry-run で 15/15/15/5 分布を出力', () => {
      const out = runSeed('--count=50 --dry-run');
      expect(out).toMatch(/分布: coming-soon=15 \/ now=15 \/ ended=15 \/ unknown=5 \(total=50\)/);
      expect(out).toContain('🧪 DRY-RUN モード');
      expect(out).toContain('50 件の MDX を準備中');
    });

    it('--count=10 --dry-run で 3:3:3:1 比例分布 (3/3/3/1=10)', () => {
      const out = runSeed('--count=10 --dry-run');
      expect(out).toMatch(/分布: coming-soon=3 \/ now=3 \/ ended=3 \/ unknown=1 \(total=10\)/);
    });

    it('--dry-run はファイル出力をスキップしサンプル MDX を表示', () => {
      const out = runSeed('--count=50 --dry-run');
      expect(out).toContain('DRY-RUN 完了');
      expect(out).toContain('サンプル MDX');
      expect(out).toMatch(/post_id: "seed-coming-001"/);
    });
  });

  describe('post_id 命名規則 (削除フローの根拠)', () => {
    it('全件が seed-{state}-{NNN} prefix を持つ (verbose 出力で検証)', () => {
      const out = runSeed('--count=50 --dry-run --verbose');
      // verbose 行の後半に post_id (work=...) フォーマットが並ぶ
      const lines = out.split('\n').filter((l) => l.includes('seed-'));
      const postIdMatches = lines
        .map((l) => l.match(/seed-(coming|now|ended|unknown)-\d{3}/))
        .filter((m): m is RegExpMatchArray => m !== null);
      expect(postIdMatches.length).toBeGreaterThanOrEqual(50);
    });

    it.each(['coming', 'now', 'ended', 'unknown'])(
      '%s 状態の post_id が verbose 出力に含まれる',
      (state) => {
        const out = runSeed('--count=50 --dry-run --verbose');
        expect(out).toContain(`seed-${state}-`);
      }
    );

    it('coming-soon に [YYYY-MM-DD → YYYY-MM-DD] の日付ペアが付く', () => {
      const out = runSeed('--count=50 --dry-run --verbose');
      const comingLine = out
        .split('\n')
        .find((l) => l.includes('[coming-soon]') && l.includes('seed-coming-'));
      expect(comingLine).toBeDefined();
      expect(comingLine!).toMatch(/\[\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}\]/);
    });

    it('unknown は [no event dates] が付く (4 フィールド省略を verbose で確認)', () => {
      const out = runSeed('--count=50 --dry-run --verbose');
      const unknownLine = out
        .split('\n')
        .find((l) => l.includes('[unknown]') && l.includes('seed-unknown-'));
      expect(unknownLine).toBeDefined();
      expect(unknownLine!).toContain('[no event dates]');
    });
  });

  describe('work_slug 分散 (RelatedArticles 経路カバー)', () => {
    it('verbose 出力に複数の work_slug が含まれる (3 種以上)', () => {
      const out = runSeed('--count=50 --dry-run --verbose');
      const workSlugs = new Set<string>();
      const matches = out.matchAll(/work=(seed-[a-z-]+)\)/g);
      for (const m of matches) {
        workSlugs.add(m[1]);
      }
      expect(workSlugs.size).toBeGreaterThanOrEqual(3);
      // 全て seed- prefix を持つ (本番作品との衝突防止)
      for (const slug of workSlugs) {
        expect(slug).toMatch(/^seed-/);
      }
    });
  });

  describe('サンプル MDX frontmatter 構造', () => {
    it('coming-soon サンプルが 4 フィールド (event_start_date / event_end_date / venue / official_url) を含む', () => {
      const out = runSeed('--count=50 --dry-run');
      // サンプル MDX 部分を抽出 (`---` で囲まれた最初のブロック)
      const fmMatch = out.match(/---\n([\s\S]*?)\n---/);
      expect(fmMatch).toBeTruthy();
      const fm = fmMatch![1];
      expect(fm).toMatch(/event_start_date: "\d{4}-\d{2}-\d{2}"/);
      expect(fm).toMatch(/event_end_date: "\d{4}-\d{2}-\d{2}"/);
      expect(fm).toMatch(/venue: "/);
      expect(fm).toMatch(/official_url: "https?:\/\//);
    });

    it('frontmatter 必須フィールドが全て揃う (post_id / year / event_type / 等)', () => {
      const out = runSeed('--count=50 --dry-run');
      const fmMatch = out.match(/---\n([\s\S]*?)\n---/);
      const fm = fmMatch![1];
      [
        'post_id:',
        'year:',
        'event_type:',
        'event_title:',
        'work_title:',
        'work_titles:',
        'work_slug:',
        'slug:',
        'title:',
        'date:',
        'categories:',
        'excerpt:',
        'author:',
        'ogImage:',
        'prefectures:',
        'prefecture_slugs:',
      ].forEach((field) => {
        expect(fm).toContain(field);
      });
    });

    it('title は 40 char 以内 (generate-article-index.test.ts の Title Validation 互換)', () => {
      const out = runSeed('--count=50 --dry-run');
      const titleMatch = out.match(/title: "([^"]+)"/);
      expect(titleMatch).toBeTruthy();
      expect(titleMatch![1].length).toBeLessThanOrEqual(40);
    });

    it('date は ISO 8601 ms 形式 (MdxFrontmatterSchema 互換)', () => {
      const out = runSeed('--count=50 --dry-run');
      const dateMatch = out.match(/date: "([^"]+)"/);
      expect(dateMatch).toBeTruthy();
      // ISO 8601 ms with Z (例: 2026-05-11T03:45:11.233Z)
      expect(dateMatch![1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('警告メッセージの存在 (削除フロー必須の周知)', () => {
    it('実行末尾に WARNING + 削除コマンドが表示される', () => {
      const out = runSeed('--count=50 --dry-run');
      expect(out).toContain('WARNING');
      expect(out).toContain('MVP リリース前に必ず削除');
      expect(out).toMatch(/find .+__seed__ -name 'seed-\*\.mdx' -delete/);
      expect(out).toContain('generate:article-index');
    });
  });

  // CLI 出力の regex マッチではなく renderMdx を直接呼び、frontmatter の構造を
  // 精密に検証する (Layer 1 純粋関数の直接 unit test)。
  describe('renderMdx (純粋関数の直接 unit test)', () => {
    const comingSpec: SeedArticle = {
      post_id: 'seed-coming-001',
      state: 'coming-soon',
      workSlug: 'seed-frieren',
      workTitle: '葬送のフリーレン',
      eventStartDate: '2026-06-01',
      eventEndDate: '2026-06-15',
      publishDate: '2026-05-20T03:00:00.000Z',
    };
    const unknownSpec: SeedArticle = {
      post_id: 'seed-unknown-050',
      state: 'unknown',
      workSlug: 'seed-spy-family',
      workTitle: 'SPY×FAMILY',
      publishDate: '2026-04-20T03:00:00.000Z',
    };

    it('coming-soon spec は 4 フィールドを frontmatter に含む', () => {
      const mdx = renderMdx(comingSpec);
      expect(mdx).toContain('event_start_date: "2026-06-01"');
      expect(mdx).toContain('event_end_date: "2026-06-15"');
      expect(mdx).toMatch(/venue: ".+"/);
      expect(mdx).toMatch(/official_url: "https?:\/\//);
    });

    it('unknown spec は 4 フィールドを一切含まない (フォールバック検証)', () => {
      const mdx = renderMdx(unknownSpec);
      expect(mdx).not.toContain('event_start_date:');
      expect(mdx).not.toContain('event_end_date:');
      expect(mdx).not.toContain('venue:');
      expect(mdx).not.toContain('official_url:');
    });

    it('title は 40 char 以内 (generate-article-index の Title Validation 互換)', () => {
      const titleLine = renderMdx(comingSpec)
        .split('\n')
        .find((l) => l.startsWith('title:'));
      expect(titleLine).toBeDefined();
      const title = titleLine!.match(/title: "([^"]+)"/)?.[1] ?? '';
      expect(title.length).toBeLessThanOrEqual(40);
    });

    it('date は ISO 8601 ms 形式 (MdxFrontmatterSchema 互換)', () => {
      const dateLine = renderMdx(comingSpec)
        .split('\n')
        .find((l) => l.startsWith('date:'));
      expect(dateLine).toMatch(/date: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/);
    });

    it('frontmatter は --- で開閉し post_id / slug が post_id と一致', () => {
      const mdx = renderMdx(comingSpec);
      expect(mdx.startsWith('---\n')).toBe(true);
      expect(mdx).toContain('post_id: "seed-coming-001"');
      expect(mdx).toContain('slug: "seed-coming-001"');
    });

    it('generateSeedSpecs の各 spec が renderMdx で例外なく描画できる', () => {
      const specs = generateSeedSpecs(calculateDistribution(50));
      for (const spec of specs) {
        expect(() => renderMdx(spec)).not.toThrow();
      }
    });
  });
});
