import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * デザイントークンの WCAG コントラスト回帰テスト。
 *
 * ## なぜ必要か
 *
 * 2026-08-22 の Claude Design v6 適用で、指定色のうち **4 組が AA (4.5:1) を
 * 割っていた**ため色相を保ったまま明度を落として是正した。その根拠は
 * `styles/globals.css` のコメントに書いてあるだけで、**将来トークンを触ったときに
 * 誰も再計算しない**という指摘を受けた (claude[bot] レビュー #334)。
 *
 * 本テストは **`globals.css` から実際の値を読んで計算する**ので、トークンを
 * 変更すると自動的に再検証される。コメントと実装が乖離しない。
 *
 * ## 判定基準
 *
 * すべて **AA の通常テキスト = 4.5:1**。対象の文字は 11-13px の小さいテキスト
 * (バッジ・チップ・カードの補助情報) なので、大文字向けの 3:1 緩和は使わない。
 */

const CSS_PATH = join(__dirname, '../../../styles/globals.css');

type Tokens = Record<string, string>;

/**
 * 行頭から始まるトップレベルのブロック (`:root {` / `.dark {`) を name → value で読み出す。
 *
 * コメントを剥がしてから探す (コメント中の文字列に引っかからないように)。ブロックが無ければ
 * 空のまま通さず、ここで失敗させる。
 */
function readBlock(selector: string): Tokens {
  const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [...css.matchAll(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)^\\}`, 'gm'))];
  if (blocks.length !== 1) {
    throw new Error(`${selector} のブロックが ${blocks.length} 個ある (1 個のはず): ${CSS_PATH}`);
  }
  const tokens: Tokens = {};
  for (const [, name, value] of blocks[0][1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

/**
 * トークン名かリテラルを、最終的な値 (16 進数など) に解決する。`var(--x)` はたどる。
 * ダークのブロックに無いトークンは、ルート要素の値を使う。ルート要素で `var()` を参照する
 * トークンもダークの値で解決するのは、next-themes が .dark をルート要素 (html) 自身に付けるため
 * (子孫の要素に .dark を付けると、継承されるのは計算済みの値なので、この解決とは合わない)。
 */
function makeResolver(...layers: Tokens[]) {
  const lookup = (name: string) => layers.map((l) => l[name]).find((v) => v !== undefined);
  const resolve = (v: string, depth = 0): string => {
    if (depth > 10) throw new Error(`var() の参照が循環している: ${v}`);
    const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
    const name = ref ? ref[1] : v.startsWith('--') ? v : undefined;
    if (!name) return v;
    const value = lookup(name);
    return value === undefined ? '' : resolve(value, depth + 1);
  };
  return resolve;
}

/** sRGB チャンネルを相対輝度の線形値へ (WCAG 2.1 の定義)。 */
function channelLuminance(int8: number): number {
  const c = int8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG コントラスト比 (1〜21)。 */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const AA_NORMAL = 4.5;

describe('contrastRatio (テストヘルパ自身の健全性)', () => {
  // 計算式が壊れていたらトークン検証も無意味になるので、既知の値で先に固定する。
  it('returns 21 for black on white and 1 for identical colors', () => {
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#1a6fa3', WHITE)).toBeCloseTo(contrastRatio(WHITE, '#1a6fa3'), 10);
  });
});

describe('デザイントークンの WCAG AA (4.5:1)', () => {
  const tokens = readBlock(':root');

  /** [説明, 前景, 背景] — トークン名は `--` 付きで書き、リテラルはそのまま。 */
  const resolve = makeResolver(tokens);

  const PAIRS: [label: string, fg: string, bg: string][] = [
    // 開催状態バッジ (v6)
    ['開催中バッジ (白文字)', WHITE, '--status-ongoing'],
    ['開催予定バッジ', '--status-scheduled-ink', '--status-scheduled-surface'],
    ['終了バッジ', '--status-ended-ink', '--status-ended-surface'],
    ['中止バッジ', '--status-cancelled', '--status-cancelled-surface'],
    ['日程未発表バッジ (塗りなし)', '--status-scheduled-ink', '--bg-elevated'],
    // 残日数バッジ (淡色地に暗文字。白文字を載せてはいけない)
    ['残日数 soon', '--ink-strong', '--days-soon'],
    ['残日数 urgent', '--ink-strong', '--days-urgent'],
    // 記事カード / アーカイブ
    ['記事カード本文', '--ink-article', '--bg-article'],
    ['記事カードのメタ行', '--ink-article-muted', '--bg-article'],
    ['アーカイブ地の本文', '--ink-archive', '--bg-archive'],
    // イベントタイプタグ / カテゴリチップ
    ['イベントタイプタグ (白文字)', WHITE, '--tag-type-surface'],
    ['カテゴリチップ (active、白文字)', WHITE, '--primary-strong'],
    ['カテゴリチップ (inactive)', '--primary-700', '--bg-tinted'],
    // 補助テキスト。載る面が複数あるので全部見る
    ['補助テキスト on カード地', '--ink-muted', '--bg-elevated'],
    ['補助テキスト on ページ地', '--ink-muted', '--bg-primary'],
    ['補助テキスト on アーカイブ地', '--ink-muted', '--bg-archive'],
    ['補助テキスト on 記事地', '--ink-muted', '--bg-article'],
    // 本文
    ['本文 on ページ地', '--ink-body', '--bg-primary'],
    ['見出し on ページ地', '--ink-strong', '--bg-primary'],
  ];

  it.each(PAIRS)('%s は AA を満たす', (_label, fg, bg) => {
    const [fgHex, bgHex] = [resolve(fg), resolve(bg)];
    // トークン名の typo / 削除を「コントラスト 0」で見逃さない。
    expect(fgHex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bgHex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(fgHex, bgHex)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('⚠️ --days-* は淡色なので白文字を載せてはいけない (規約の固定)', () => {
    // globals.css のコメントで禁止している組み合わせ。実際に AA を割ることを
    // テストで示しておく (将来 `text-white` を当てる変更への歯止め)。
    for (const token of ['--days-soon', '--days-urgent']) {
      expect(contrastRatio(WHITE, tokens[token])).toBeLessThan(AA_NORMAL);
    }
  });
});

/**
 * shadcn/ui の意味のトークン (`--background` / `--foreground` など) の組み合わせ。
 * 部品はこの組で文字と地を塗るので、ライトとダークの両方で AA を確かめる。
 * ダークのブロックに無いトークンはルート要素の値になる (CSS と同じ)。
 */
describe('意味のトークンの WCAG AA (4.5:1、ライトとダーク)', () => {
  const root = readBlock(':root');
  const dark = readBlock('.dark');

  const SEMANTIC_PAIRS: [label: string, fg: string, bg: string][] = [
    ['本文 on 地', '--foreground', '--background'],
    ['カード', '--card-foreground', '--card'],
    ['ポップオーバー', '--popover-foreground', '--popover'],
    ['主ボタン', '--primary-foreground', '--primary'],
    ['副ボタン', '--secondary-foreground', '--secondary'],
    ['控えめな地', '--muted-foreground', '--muted'],
    ['補助テキスト on 地', '--muted-foreground', '--background'],
    ['補助テキスト on カード', '--muted-foreground', '--card'],
    ['hover の地', '--accent-foreground', '--accent'],
    ['エラーの文字 on 地', '--destructive', '--background'],
    ['エラーの文字 on カード', '--destructive', '--card'],
  ];

  describe.each([
    ['ライト', makeResolver(root)],
    ['ダーク', makeResolver(dark, root)],
  ])('%s', (_theme, resolve) => {
    it.each(SEMANTIC_PAIRS)('%s は AA を満たす', (_label, fg, bg) => {
      const [fgHex, bgHex] = [resolve(fg), resolve(bg)];
      expect(fgHex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(bgHex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(fgHex, bgHex)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  it('ダークのブロックは、文字の組と罫線・入力欄・フォーカスの意味のトークンを上書きする', () => {
    // 文字の組に出ない罫線・入力欄・フォーカスの色も、ダークで上書きされていること
    const semantic = new Set(
      SEMANTIC_PAIRS.flatMap(([, fg, bg]) => [fg, bg]).concat(['--border', '--input', '--ring']),
    );
    for (const name of semantic) {
      expect(root).toHaveProperty([name]);
      expect(dark).toHaveProperty([name]);
    }
  });
});

/**
 * `animate-[<name>_…]` で参照している keyframes が `globals.css` に実在するか。
 *
 * ★ 2026-08-22 の回帰を受けて追加。`.rail` ユーティリティを足す際に
 * `@keyframes livePulse` を巻き込んで削除してしまい、**「開催中」バッジの
 * ライブドットが全ページで静止**していた。
 *
 * Tailwind の arbitrary な `animate-[…]` は**存在しない keyframes を参照しても
 * ビルドが通る**ため、tsc / eslint / 既存テストのどれも検出できなかった
 * (claude[bot] 5 件と `/code-review` が揃って指摘)。
 * クラス側から keyframes 名を集めて突き合わせることで、同じ消し漏れを塞ぐ。
 */
describe('animate-[…] が参照する @keyframes の存在', () => {
  /*
   * ⚠️ **コメントを剥がしてから照合する。** `globals.css` の解説コメント自身が
   *    `@keyframes livePulse` という文字列を含むため、素のテキストを検索すると
   *    **実際の規則を消してもコメントにマッチして通ってしまう**
   *    (2026-08-22、このテストを mutation test にかけて発覚)。
   */
  const CSS = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const COMPONENTS = join(__dirname, '../../../components');

  /** `components/` 配下の tsx を再帰的に読む。 */
  function readAllTsx(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return readAllTsx(full);
      return entry.name.endsWith('.tsx') ? [readFileSync(full, 'utf8')] : [];
    });
  }

  it('defines every keyframes name referenced by an arbitrary animate utility', () => {
    const referenced = new Set<string>();
    for (const source of readAllTsx(COMPONENTS)) {
      for (const [, name] of source.matchAll(/animate-\[([A-Za-z][\w-]*)[_\]]/g)) {
        referenced.add(name);
      }
    }

    // 参照が 1 つも拾えない = 正規表現が壊れている。テストが空振りしないよう固定する。
    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced]).toContain('livePulse');

    for (const name of referenced) {
      expect(CSS).toMatch(new RegExp(`@keyframes\\s+${name}\\b`));
    }
  });
});
