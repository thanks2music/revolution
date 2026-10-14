/**
 * Layer 1: 画像のプレースホルダーの置換 (`image-placeholder-replacer.service.ts`)。
 * 2026-10-13: 寸法付きの `<ArticleImage>` で書く / 品目ごとの画像がある節は消さない。
 */
import {
  ImagePlaceholderReplacerService,
  PLACEHOLDERS,
  removePlaceholderBlock,
} from '@/lib/services/image-placeholder-replacer.service';

const ref = (n: number, height = 600) => ({ url: `https://images.example.com/${n}.webp`, width: 800, height });

const ARTICLE = [
  PLACEHOLDERS.eyecatch,
  '',
  '## カフェのメニュー',
  '',
  'メニューの文',
  '',
  PLACEHOLDERS.menu,
  '',
  '## カフェのグッズ',
  '',
  'グッズの文',
  '',
  '### グッズラインナップ',
  '',
  PLACEHOLDERS.goods,
  '',
  '## まとめ',
].join('\n');

describe('ImagePlaceholderReplacerService.replaceAll', () => {
  const service = new ImagePlaceholderReplacerService();

  it('アイキャッチとカテゴリの画像を寸法付きの <ArticleImage> で書き、分割した片には part を付ける', () => {
    const result = service.replaceAll(
      ARTICLE,
      { eyecatch: ref(0, 630), menu: [[ref(1, 4800), ref(2, 400)]], novelty: [], goods: [[ref(3)]] },
      'ヒロアカカフェ'
    );

    expect(result.content).toContain(
      '<ArticleImage src="https://images.example.com/0.webp" alt="ヒロアカカフェ アイキャッチ" width="800" height="630" />'
    );
    expect(result.content).toContain('alt="ヒロアカカフェ コラボメニュー1 (1/2)" width="800" height="4800" part="first" />');
    expect(result.content).toContain('alt="ヒロアカカフェ コラボメニュー1 (2/2)" width="800" height="400" part="last" />');
    expect(result.content).toContain('alt="ヒロアカカフェ グッズ1"');
    expect(result.replacedCount).toMatchObject({ eyecatch: 1, menu: 1, goods: 1 });
  });

  it('画像の無いカテゴリは節ごと消す。keepSections のカテゴリは節を残し、画像の欄 (と、それだけの見出し) を消す', () => {
    const result = service.replaceAll(
      ARTICLE,
      { menu: [], novelty: [], goods: [] },
      'ヒロアカカフェ',
      new Set(['goods'])
    );

    expect(result.removedSections).toEqual(['menu']);
    expect(result.content).not.toContain('## カフェのメニュー');
    expect(result.content).toContain('## カフェのグッズ\n\nグッズの文\n\n## まとめ');
    expect(result.content).not.toContain(PLACEHOLDERS.goods);
  });
});

describe('ImagePlaceholderReplacerService.replaceAll (deferred)', () => {
  it('deferred のカテゴリはプレースホルダーを残し、未置換の警告にも数えない (後の段で置き換える)', () => {
    const result = new ImagePlaceholderReplacerService().replaceAll(
      ARTICLE,
      { menu: [[ref(1)]], novelty: [], goods: [[ref(3)]] },
      'ヒロアカカフェ',
      new Set(['menu']),
      new Set(['menu'])
    );

    expect(result.content).toContain(PLACEHOLDERS.menu);
    expect(result.unreplacedPlaceholders).not.toContain(PLACEHOLDERS.menu);
    expect(result.content).not.toContain(PLACEHOLDERS.goods);
  });
});

describe('removePlaceholderBlock', () => {
  it('見出しの下に地の文があれば、見出しは残してプレースホルダーの行だけ消す', () => {
    const content = ['### グッズ', '', '文', '', PLACEHOLDERS.goods, '', '## 次'].join('\n');
    expect(removePlaceholderBlock(content, PLACEHOLDERS.goods)).toBe(['### グッズ', '', '文', '', '## 次'].join('\n'));
  });

  it('プレースホルダーが無ければそのまま', () => {
    expect(removePlaceholderBlock('本文', PLACEHOLDERS.goods)).toBe('本文');
  });
});
