/**
 * Layer 1: 本文の節に抽出結果をコードで差し込む (`section-renderers.ts`、2026-10-12)。
 *
 * 本文の LLM が名前を書き写すと誤字が混ざる (「招待状（ランダム7种）」) ため、名前の入る部分を差し替える。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExtractionMenuItem } from '@revolution/schemas/extraction-response';
import {
  fillTemplate,
  findSection,
  loadSectionYaml,
  hasMenuSection,
  renderMenuItems,
  replaceMenuItems,
  replaceNoveltySentence,
} from '@/lib/services/section-renderers';

/** Templates の sections/02-menu.yaml の rendered.item_line と同じ */
const ITEM_LINE = '### {{#if character}}【{{character}}】{{/if}}{{name}}{{#if price}} {{price}}{{/if}}';
/** Templates の sections/03-novelty.yaml の rendered.sentence と同じ */
const NOVELTY_SENTENCE = "「{{作品名}}」カフェでは、ノベルティー「{{ノベルティ名|join:'」「'}}」が用意されている。";

const item = (name: string, price: string | null = null, character: string | null = null): ExtractionMenuItem => ({
  character,
  name,
  price,
  imageUrl: null,
  copyright: null,
});

describe('fillTemplate', () => {
  it('{{x}}・{{x|join}}・{{#if x}} を扱い、空の値の if は落とす', () => {
    expect(fillTemplate('{{a}}{{#if b}}+{{b}}{{/if}}「{{c|join:\'」「\'}}」', { a: 'A', b: '', c: ['x', 'y'] })).toBe(
      'A「x」「y」'
    );
  });
});

describe('renderMenuItems', () => {
  it('品名・価格・キャラクターを書式どおりに並べ、無い部分は書かない。{ < はエスケープする', () => {
    expect(
      renderMenuItems([item('マルゲリータ', '2,090円(税込)', 'オールマイト'), item('<限定>ドリンク')], ITEM_LINE)
    ).toEqual(['### 【オールマイト】マルゲリータ 2,090円(税込)', '### &#60;限定&#62;ドリンク']);
  });

  it('品目ごとの画像があれば、その品目の見出しの直後に続ける (2026-10-13)', () => {
    const image = '<ArticleImage src="https://images.example.com/a.webp" alt="マルゲリータ" width="800" height="800" />';
    expect(renderMenuItems([item('マルゲリータ'), item('サラダ')], ITEM_LINE, [image, ''])).toEqual([
      `### マルゲリータ\n\n${image}`,
      '### サラダ',
    ]);
  });
});

describe('replaceMenuItems', () => {
  const ARTICLE = [
    '## カフェのメニュー',
    '',
    '導入文',
    '',
    '### 【緑谷出久】バジルクリームとリコッタ 2,090円(税込)', // LLM の打ち直しの誤り
    '',
    '### テリヤキチキン 2,090円(税込)',
    '',
    '![メニュー1](https://example.com/1.jpg)',
    '',
    '## カフェのノベルティー',
    '',
    'ノベルティの文',
  ].join('\n');

  it('LLM が書いた品目の見出しを消し、最初の位置に抽出結果の品目を並べる (導入文と画像は残す)', () => {
    const result = replaceMenuItems(ARTICLE, ['### 【緑谷出久】バジルクリームとルッコラ 2,090円(税込)', '### 【ホークス】てりマヨチキン 2,090円(税込)']);

    expect(result).toBe(
      [
        '## カフェのメニュー',
        '',
        '導入文',
        '',
        '### 【緑谷出久】バジルクリームとルッコラ 2,090円(税込)',
        '',
        '### 【ホークス】てりマヨチキン 2,090円(税込)',
        '',
        '![メニュー1](https://example.com/1.jpg)',
        '',
        '## カフェのノベルティー',
        '',
        'ノベルティの文',
      ].join('\n')
    );
  });

  it('品目ごとの説明・<img>・コピーライトの行も一緒に消す (品目と離れて取り残されないように)', () => {
    const article = [
      '## カフェのメニュー',
      '',
      '導入文',
      '',
      '### 【A】品目1 100円',
      '<img src="https://example.com/1.jpg" alt="品目1">',
      '<p><small>©A</small></p>',
      '',
      '品目1をイメージした一品。',
      '',
      '### 品目2',
      '',
      '{ここにメニューの画像を入れる}',
      '',
    ].join('\n');

    expect(replaceMenuItems(article, ['### 【A】品目1 100円', '### 品目2'])).toBe(
      ['## カフェのメニュー', '', '導入文', '', '### 【A】品目1 100円', '', '### 品目2', '', '{ここにメニューの画像を入れる}', ''].join('\n')
    );
  });

  it('LLM が品目を書いていなければ、最初の画像の手前に並べる', () => {
    const result = replaceMenuItems('## カフェのメニュー\n\n導入文\n\n![m](https://example.com/1.jpg)\n', ['### パフェ']);

    expect(result).toBe('## カフェのメニュー\n\n導入文\n\n### パフェ\n\n![m](https://example.com/1.jpg)\n');
  });

  it('メニューの節が無い、または品目が無ければそのまま', () => {
    expect(replaceMenuItems('## まとめ\n', ['### パフェ'])).toBe('## まとめ\n');
    expect(replaceMenuItems(ARTICLE, [])).toBe(ARTICLE);
  });
});

describe('replaceMenuItems と <ArticleImage>', () => {
  it('節の末尾の <ArticleImage> は画像の欄として残す (品目の範囲に含めない)', () => {
    const tail = '<ArticleImage src="https://images.example.com/r.webp" alt="メニュー1" width="800" height="600" />';
    const article = ['## カフェのメニュー', '', '導入文', '', '### LLM の品目', '', tail, ''].join('\n');

    expect(replaceMenuItems(article, ['### マルゲリータ'])).toBe(
      ['## カフェのメニュー', '', '導入文', '', '### マルゲリータ', '', tail, ''].join('\n')
    );
  });
});

describe('hasMenuSection', () => {
  it('## …メニュー の見出しがあるか', () => {
    expect(hasMenuSection('## {{見出し主語}}のメニュー\n\n文')).toBe(true);
    expect(hasMenuSection('## フード・ドリンク\n\n文')).toBe(false);
  });
});

describe('replaceNoveltySentence と <ArticleImage>', () => {
  it('地の文が無く画像が先にあるとき、画像を地の文と取り違えず、見出しの直後に入れる', () => {
    const image = '<ArticleImage src="https://images.example.com/n.webp" alt="ノベルティ1" width="800" height="800" />';
    const article = ['## カフェのノベルティー', '', image, '', '## 次'].join('\n');

    const result = replaceNoveltySentence(article, '文');

    expect(result).toContain(image);
    expect(result.indexOf('文')).toBeLessThan(result.indexOf(image));
  });
});

describe('replaceNoveltySentence', () => {
  const sentence = fillTemplate(NOVELTY_SENTENCE, { 作品名: '名探偵コナン', ノベルティ名: ['招待状（ランダム7種）', 'ナゾトキブック（全1種）'] });

  it('ノベルティの節の見出しの直後の段落を差し替え、小見出しと画像は残す', () => {
    const article = [
      '## メニュー',
      '',
      'メニューの文',
      '',
      '## コナンカフェのノベルティー',
      '',
      '「名探偵コナン」カフェでは、ノベルティー「招待状（ランダム7种）」が用意されている。',
      '',
      '### ノベルティー',
      '',
      '![n](https://example.com/n.jpg)',
      '',
      '## グッズ',
    ].join('\n');

    expect(replaceNoveltySentence(article, sentence)).toBe(
      article.replace(
        '「名探偵コナン」カフェでは、ノベルティー「招待状（ランダム7种）」が用意されている。',
        '「名探偵コナン」カフェでは、ノベルティー「招待状（ランダム7種）」「ナゾトキブック（全1種）」が用意されている。'
      )
    );
  });

  it('地の文が無ければ見出しの直後に入れる。節が無ければそのまま', () => {
    expect(replaceNoveltySentence('## Xのノベルティー\n\n### ノベルティー\n', sentence)).toBe(
      `## Xのノベルティー\n\n${sentence}\n\n### ノベルティー\n`
    );
    expect(replaceNoveltySentence('## まとめ\n', sentence)).toBe('## まとめ\n');
  });

  it('文に $ が含まれても置換の特殊文字として扱わない', () => {
    expect(replaceNoveltySentence('## Xのノベルティー\n\n古い文\n', 'A$&B')).toBe('## Xのノベルティー\n\nA$&B\n');
  });
});

describe('findSection / loadSectionYaml', () => {
  it('節の範囲は見出しの直後から次の ## の手前まで', () => {
    const content = '## a\nx\n## b\ny\n';
    const range = findSection(content, /^## b$/m)!;
    expect(content.slice(range.start, range.end)).toBe('\ny\n');
  });

  it('YAML に key が無ければ同期を促して止まる', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sections-'));
    fs.writeFileSync(path.join(dir, '02-menu.yaml'), 'section:\n  id: menu\n');
    expect(() => loadSectionYaml('02-menu.yaml', 'rendered', dir)).toThrow(/sync:templates/);
  });
});
