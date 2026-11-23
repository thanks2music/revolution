import { describe, expect, it } from '@jest/globals';

import {
  buildNoNoveltySecondParagraph,
  replaceSecondParagraph,
  type NoNoveltySecondParagraphConfig,
} from '@/lib/services/lead-second-paragraph';

/** 01-lead.yaml の rendered.no_novelty_name_second_paragraph の一部 */
const CONFIG: NoNoveltySecondParagraphConfig = {
  templates: {
    lead_author_with_characters: 'work',
    lead_game_generic: 'game',
    lead_author_with_theme_and_characters: 'work',
    lead_character_with_characters: 'plain',
  },
  goods_in_third_paragraph: ['lead_author_with_theme_and_characters'],
  media_form_omit: ['作品'],
  menu_work: '「{{作品名}}」コラボカフェでは、作品の世界観やキャラクターをイメージしたコラボメニューがお楽しみいただける',
  menu_game: '「{{作品名}}」コラボカフェでは、ゲームの世界観やキャラクターをイメージしたコラボメニューがお楽しみいただける',
  menu_plain: '「{{作品名}}」コラボカフェでは、コラボメニューやグッズがお楽しみいただける',
  menu_plain_no_goods: '「{{作品名}}」コラボカフェでは、コラボメニューがお楽しみいただける',
  goods_and_novelty: '他、{{メディア形態}}「{{作品名}}」のコラボグッズや、ノベルティーも展開される',
  goods_only: '他、{{メディア形態}}「{{作品名}}」のコラボグッズも展開される',
  novelty_only: '他、ノベルティーも展開される',
  novelty_named: "他、ノベルティー「{{ノベルティ名|join:'」「'}}」も用意されている",
  end: '。',
};

const base = { templateId: 'lead_author_with_characters', 作品名: '作品A', mediaForm: 'アニメ', hasGoods: true, hasNovelty: true };

describe('buildNoNoveltySecondParagraph', () => {
  it('グッズとノベルティーの節があれば、両方を書く (キャラクター名は書かない)', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, base)).toBe(
      '「作品A」コラボカフェでは、作品の世界観やキャラクターをイメージしたコラボメニューがお楽しみいただける他、アニメ「作品A」のコラボグッズや、ノベルティーも展開される。',
    );
  });

  it('節がある物だけ書き、両方無ければメニューの文で終える', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, hasNovelty: false })).toMatch(/他、アニメ「作品A」のコラボグッズも展開される。$/);
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, hasGoods: false })).toMatch(/お楽しみいただける他、ノベルティーも展開される。$/);
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, hasGoods: false, hasNovelty: false })).toMatch(/お楽しみいただける。$/);
  });

  it('メディア形態が「作品」なら書かない', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, mediaForm: '作品', hasNovelty: false })).toContain('他、「作品A」のコラボグッズ');
  });

  it('ゲームのひな型は「ゲームの世界観」の文にする', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, templateId: 'lead_game_generic', mediaForm: 'ゲーム' })).toContain(
      'ゲームの世界観やキャラクターをイメージしたコラボメニューがお楽しみいただける他、ゲーム「作品A」のコラボグッズや',
    );
  });

  it('3 段落目でグッズを書くひな型では、2 段落目でグッズに触れない', () => {
    expect(
      buildNoNoveltySecondParagraph(CONFIG, { ...base, templateId: 'lead_author_with_theme_and_characters' }),
    ).toMatch(/お楽しみいただける他、ノベルティーも展開される。$/);
  });

  it('ノベルティ名があれば (メニューの品名が無いとき)、ひな型と同じくノベルティ名を書き、グッズには触れない', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, noveltyNames: ['カードA', 'カードB'] })).toBe(
      '「作品A」コラボカフェでは、作品の世界観やキャラクターをイメージしたコラボメニューがお楽しみいただける他、ノベルティー「カードA」「カードB」も用意されている。',
    );
  });

  it('plain のひな型は、グッズ・ノベルティーの文を足さない', () => {
    expect(
      buildNoNoveltySecondParagraph(CONFIG, { ...base, templateId: 'lead_character_with_characters', noveltyNames: ['カード'] }),
    ).toBe('「作品A」コラボカフェでは、コラボメニューやグッズがお楽しみいただける。');
    expect(
      buildNoNoveltySecondParagraph(CONFIG, { ...base, templateId: 'lead_character_with_characters', hasGoods: false }),
    ).toBe('「作品A」コラボカフェでは、コラボメニューがお楽しみいただける。');
  });

  it('設定に無いひな型 (VTuber・複数作品など) は null', () => {
    expect(buildNoNoveltySecondParagraph(CONFIG, { ...base, templateId: 'lead_vtuber' })).toBeNull();
  });
});

describe('replaceSecondParagraph', () => {
  it('2 段落目だけを置き換え、末尾の改行を残す', () => {
    expect(replaceSecondParagraph('1 段落目。\n\n2 段落目。\n', '新しい文。')).toBe('1 段落目。\n\n新しい文。\n');
    expect(replaceSecondParagraph('1。\n\n2。\n\n3。', '新。')).toBe('1。\n\n新。\n\n3。');
  });

  it('2 段落目の外の空白・改行は変えない (記事全体に当てるとき)', () => {
    const article = '1。\n\n2。\n\n\n<ArticleImage />\n\n\n## 節\n';
    expect(replaceSecondParagraph(article, '新。')).toBe('1。\n\n新。\n\n\n<ArticleImage />\n\n\n## 節\n');
  });

  it('段落が 1 つなら、そのまま', () => {
    expect(replaceSecondParagraph('1 段落目。', '新しい文。')).toBe('1 段落目。');
  });
});
