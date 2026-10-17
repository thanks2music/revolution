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
  appendToNoveltySection,
  fillTemplate,
  findSection,
  loadSectionYaml,
  hasMenuSection,
  renderMenuItems,
  renderMenuTable,
  replaceMenuItems,
  replaceMenuItemsWithTable,
  replaceSummaryRowValue,
  upsertSummaryRow,
  replacePlaceholderLine,
  renderVenueList,
  loadRendered,
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

describe('replaceMenuItems と残したプレースホルダー', () => {
  it('プレースホルダーが品目の範囲の終わりの目印になり、その後ろの LLM の文は消さない (品目ごとの形のメニュー)', () => {
    const article = ['## カフェのメニュー', '', '導入文', '', '### LLM の品目', '', '{ここにメニューの画像を入れる}', '', '※画像はイメージです', ''].join('\n');

    expect(replaceMenuItems(article, ['### マルゲリータ'])).toBe(
      ['## カフェのメニュー', '', '導入文', '', '### マルゲリータ', '', '{ここにメニューの画像を入れる}', '', '※画像はイメージです', ''].join('\n')
    );
  });
});

describe('replacePlaceholderLine', () => {
  const PH = '{ここにメニューの画像を入れる}';

  it('プレースホルダーの行だけを置き換え、直前の品目の見出しは消さない (全画像が品目に付いて、残りが無いとき)', () => {
    const content = ['### A 800円', '', 'IMG', '', '### B 900円', '', PH, '', '※画像はイメージです'].join('\n');
    expect(replacePlaceholderLine(content, PH, '')).toBe(['### A 800円', '', 'IMG', '', '### B 900円', '', '※画像はイメージです'].join('\n'));
    expect(replacePlaceholderLine(content, PH, '### その他参考画像\n\nREST')).toContain('### B 900円\n\n### その他参考画像\n\nREST\n\n※画像は');
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

/** Templates の sections/02-menu.yaml の rendered.table と同じ */
const TABLE = {
  head_character: 'キャラクター名',
  head_menu: 'メニュー名(値段)',
  no_character: 'その他',
  menu_cell: '{{name}}{{#if price}} {{price}}{{/if}}',
};

describe('renderMenuTable', () => {
  it('見出し行と、行の見出し (th) にキャラクター名・セル (td) に品名と価格を並べる。キャラクターが無ければ「その他」', () => {
    expect(
      renderMenuTable([item('バジルクリームとルッコラ', '2,090円(税込)', '緑谷出久'), item('<限定>プレート')], TABLE).split('\n')
    ).toEqual([
      '<div className="article-table-scroll">',
      '<table>',
      '<thead><tr><th scope="col">キャラクター名</th><th scope="col">メニュー名(値段)</th></tr></thead>',
      '<tbody>',
      '<tr><th scope="row">緑谷出久</th><td>バジルクリームとルッコラ 2,090円(税込)</td></tr>',
      '<tr><th scope="row">その他</th><td>&#60;限定&#62;プレート</td></tr>',
      '</tbody>',
      '</table>',
      '</div>',
    ]);
  });
});

describe('replaceMenuItemsWithTable', () => {
  const image = '<ArticleImage src="https://images.example.com/m.webp" alt="メニュー1 (1/2)" width="1600" height="4800" part="first" />';
  const ARTICLE = [
    '## カフェのメニュー',
    '',
    '導入文',
    '',
    '### 【緑谷出久】打ち直しの品目 2,090円(税込)',
    '',
    '### テリヤキチキン',
    '',
    image,
    '',
    '## カフェのノベルティー',
    '',
    'ノベルティの文',
  ].join('\n');

  it('LLM が書いた品目の見出しを消し、表を節の末尾 (メニューの画像の下) に置く', () => {
    expect(replaceMenuItemsWithTable(ARTICLE, '<table>\n</table>')).toBe(
      ['## カフェのメニュー', '', '導入文', '', image, '', '<table>', '</table>', '', '## カフェのノベルティー', '', 'ノベルティの文'].join('\n')
    );
  });

  it('メニューの節が無ければそのまま', () => {
    expect(replaceMenuItemsWithTable('## ノベルティー\n\n文', '<table>\n</table>')).toBe('## ノベルティー\n\n文');
  });
});

describe('appendToNoveltySection', () => {
  it('ノベルティの節の末尾 (次の ## の前) に、空行を挟んで差し込む', () => {
    const article = ['## カフェのノベルティー', '', '導入の文', '', '## カフェのグッズ', '', 'グッズの文'].join('\n');

    expect(appendToNoveltySection(article, '### ホログラムステッカー\n\n### オリジナルコースター（全7種）')).toBe(
      [
        '## カフェのノベルティー',
        '',
        '導入の文',
        '',
        '### ホログラムステッカー',
        '',
        '### オリジナルコースター（全7種）',
        '',
        '## カフェのグッズ',
        '',
        'グッズの文',
      ].join('\n')
    );
  });

  it('節が無い、または差し込むものが無ければそのまま', () => {
    expect(appendToNoveltySection('## メニュー\n\n文', '### x')).toBe('## メニュー\n\n文');
    expect(appendToNoveltySection('## ノベルティー\n\n文', '')).toBe('## ノベルティー\n\n文');
  });
});

describe('replaceSummaryRowValue', () => {
  const TABLE = ['| 項目 | 内容 |', '|------|------|', '| 開催場所 | 東京・愛知・大阪・北海道の各会場 |', '| 開催期間 | 2026年10月16日〜 |'].join('\n');

  it('LLM が書いた「開催場所」のセルを置き換える', () => {
    expect(replaceSummaryRowValue(TABLE, '開催場所', '・A店<br />・B店')).toBe(
      ['| 項目 | 内容 |', '|------|------|', '| 開催場所 | ・A店<br />・B店 |', '| 開催期間 | 2026年10月16日〜 |'].join('\n')
    );
  });

  it('同じ名前の行が前の節の表にもあれば、最後の行 (まとめの表) だけを置き換える。行の末尾の | が無くてもよい', () => {
    const article = ['| 開催場所 | 前の節の表 |', '', '## まとめ', '', '| 開催場所 | 東京の各会場'].join('\n');
    expect(replaceSummaryRowValue(article, '開催場所', 'A店')).toBe(
      ['| 開催場所 | 前の節の表 |', '', '## まとめ', '', '| 開催場所 | A店 |'].join('\n')
    );
  });

  it('値が空、または行が無ければそのまま (会場のデータが無いときは LLM の文を残す)', () => {
    expect(replaceSummaryRowValue(TABLE, '開催場所', '')).toBe(TABLE);
    expect(replaceSummaryRowValue(TABLE, '会場', 'x')).toBe(TABLE);
  });
});

describe('upsertSummaryRow', () => {
  const TABLE = ['## まとめ', '', '| 項目 | 内容 |', '|------|------|', '| 開催場所 | A店 |', '| 開催期間 | 2026年10月16日〜12月20日 |'].join('\n');

  it('行があれば置き換える', () => {
    expect(upsertSummaryRow(TABLE, '開催期間', '2026年10月16日〜12月20日（会場により異なる）', ['開催場所'])).toEqual({
      content: TABLE.replace('| 2026年10月16日〜12月20日 |', '| 2026年10月16日〜12月20日（会場により異なる） |'),
      status: 'replaced',
    });
  });

  it('行が無ければ、after の行の直後に足す (LLM が「お問い合わせ」の行を書かなかったとき)', () => {
    const article = `${TABLE}\n\n本文`;
    expect(upsertSummaryRow(article, 'お問い合わせ', '各開催店舗にお問い合わせください', ['地図', '開催期間'])).toEqual({
      content: `${TABLE}\n| お問い合わせ | 各開催店舗にお問い合わせください |\n\n本文`,
      status: 'inserted',
    });
  });

  it('after は先に並べた行を優先する (「地図」があればその後ろ)', () => {
    const withMap = `${TABLE}\n| 地図 | 住所 |`;
    expect(upsertSummaryRow(withMap, 'お問い合わせ', 'x', ['地図', '開催期間']).content).toBe(`${withMap}\n| お問い合わせ | x |`);
  });

  it('まとめの節 (記事の最後の節) の外の表には触らない', () => {
    const article = ['## メニュー', '', '| お問い合わせ | 前の節 |', '| 開催期間 | 前の節 |', '', TABLE].join('\n');
    const result = upsertSummaryRow(article, 'お問い合わせ', 'x', ['開催期間']);
    expect(result.status).toBe('inserted');
    expect(result.content).toBe(`${article}\n| お問い合わせ | x |`);
  });

  it('まとめの後ろに節があっても、まとめの表に書く', () => {
    const article = `${TABLE}\n\n## 関連情報\n\n本文`;
    expect(upsertSummaryRow(article, 'お問い合わせ', 'x', ['開催期間']).content).toBe(
      `${TABLE}\n| お問い合わせ | x |\n\n## 関連情報\n\n本文`,
    );
  });

  it('まとめの後ろのコードブロックに行頭の ## があっても影響を受けない', () => {
    const article = `${TABLE}\n\n\`\`\`\n## コード\n\`\`\``;
    expect(upsertSummaryRow(article, '開催期間', 'y', ['開催場所'])).toEqual({
      content: article.replace('| 2026年10月16日〜12月20日 |', '| y |'),
      status: 'replaced',
    });
  });

  it('行も after の行も無ければ missing', () => {
    expect(upsertSummaryRow(TABLE, 'お問い合わせ', 'x', ['地図'])).toEqual({ content: TABLE, status: 'missing' });
  });
});

describe('renderVenueList', () => {
  const CONFIG = { venue_list_item: '・{{venue}}', venue_list_separator: '<br />' };

  it('2 会場以上は「・」を付けて <br /> でつなぎ、1 会場は名前だけ。名前の { < | は文字参照・全角にする', () => {
    expect(renderVenueList(['A店', 'カフェ{ROOM}|渋谷'], CONFIG)).toBe('・A店<br />・カフェ&#123;ROOM&#125;｜渋谷');
    expect(renderVenueList(['<特設>会場'], CONFIG)).toBe('&#60;特設&#62;会場');
    expect(renderVenueList([], CONFIG)).toBe('');
  });
});

describe('loadRendered', () => {
  it('rendered にキーが無ければ、名前を挙げて止める', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendered-'));
    fs.writeFileSync(path.join(dir, 'x.yaml'), 'rendered:\n  a: "1"\n');
    expect(loadRendered<{ a: string }>('x.yaml', ['a'], dir)).toEqual({ a: '1' });
    expect(() => loadRendered<{ a: string; b: string; c: string }>('x.yaml', ['a', 'b', 'c'], dir)).toThrow(
      'x.yaml の rendered に b / c がありません'
    );
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
