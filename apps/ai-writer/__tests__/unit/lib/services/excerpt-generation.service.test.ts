import { describe, expect, it, jest } from '@jest/globals';

import type { AiProvider } from '@/lib/ai/providers/ai-provider.interface';
import {
  ExcerptGenerationService,
  ExcerptParseError,
  ExcerptPromptMissingError,
  fallbackExcerpt,
  mdxToPlainText,
  normalizeExcerpt,
  pointsLinesOf,
} from '@/lib/services/excerpt-generation.service';
import type { YamlTemplateLoaderService } from '@/lib/services/yaml-template-loader.service';

/**
 * 記事の抜粋 (Layer 1: リード文と枠の読み方・抜粋の整え方、Layer 2: AI は mock)。
 */

const LEAD = [
  '人気作品「名探偵コナン」× 東京・神奈川・愛知・大阪・宮城・北海道の各会場にて2026年4月10日〜8月2日までコラボカフェが開催される。',
  '',
  '「名探偵コナン」コラボカフェでは、コラボメニューがお楽しみいただける他、ノベルティー「招待状（ランダム7種）」も用意されている。',
  '',
  'さらに「港町レトロ」をテーマに江戸川コナンら人気キャラクター達の描き下ろしイラストを使用した「缶バッジ」などのコラボグッズも発売!',
].join('\n');

const POINTS = [
  '<ArticlePoints>',
  '',
  '- 2026年4月10日〜8月2日、東京・神奈川・愛知・大阪・宮城・北海道の10会場',
  '- 描き下ろしイラストを使用',
  '- 「&#123;名探偵&#125;」の謎解き企画が実施される',
  '',
  '</ArticlePoints>',
].join('\n');

const TEMPLATE = {
  prompts: { write_excerpt: 'T={{title}}\n作品={{作品名}}\nL={{lead}}\nP=\n{{points}}\n上限={{max_length}}' },
};

function build(content: string | Error, template: unknown = TEMPLATE) {
  const sendMessage = jest.fn(async () => {
    if (content instanceof Error) throw content;
    return { content, model: 'test-model', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  });
  const loader = { loadModularTemplate: jest.fn(async () => template) } as unknown as YamlTemplateLoaderService;
  const service = new ExcerptGenerationService(loader, { sendMessage } as unknown as AiProvider);
  return { service, sendMessage };
}

describe('mdxToPlainText', () => {
  it('タグ・リンク・見出し・強調を外し、段落を空白 1 つでつなぐ。数値文字参照は文字に戻す', () => {
    expect(mdxToPlainText('## 見出し\n\n<moreads></moreads>**強調**と[リンク](https://example.com)\n\n&#123;x&#125;')).toBe(
      '見出し 強調とリンク {x}'
    );
  });
});

describe('mdxToPlainText (数値文字参照)', () => {
  it('Unicode の範囲外の数値文字参照は戻さずに残す (例外にしない)', () => {
    expect(mdxToPlainText('a&#99999999;b')).toBe('a&#99999999;b');
  });
});

describe('pointsLinesOf', () => {
  it('枠の箇条書きの行だけを取り出し、数値文字参照を文字に戻す', () => {
    expect(pointsLinesOf(POINTS)).toEqual([
      '2026年4月10日〜8月2日、東京・神奈川・愛知・大阪・宮城・北海道の10会場',
      '描き下ろしイラストを使用',
      '「{名探偵}」の謎解き企画が実施される',
    ]);
  });

  it('枠が無ければ空', () => {
    expect(pointsLinesOf('')).toEqual([]);
  });
});

describe('normalizeExcerpt', () => {
  it('1 段落にし、二重引用符 (半角・全角) はかぎ括弧に置き換える。対にならない二重引用符は消し、アポストロフィは残す', () => {
    expect(normalizeExcerpt('  "港町レトロ"をテーマに\nした カフェ  ', 150)).toBe('「港町レトロ」をテーマに した カフェ');
    expect(normalizeExcerpt('“港町レトロ”とGirls’ Band', 150)).toBe('「港町レトロ」とGirls’ Band');
    expect(normalizeExcerpt('閉じない“引用', 150)).toBe('閉じない引用');
  });

  it('字数はコードポイントで数え、サロゲートペアの途中で切らない', () => {
    const result = normalizeExcerpt('𩸽'.repeat(10), 5);
    expect(Array.from(result)).toHaveLength(5);
    expect(result).toBe('𩸽𩸽𩸽𩸽…');
  });

  it('上限を超えたら切り詰めて「…」を付ける (上限の字数に収める)', () => {
    const result = normalizeExcerpt('あ'.repeat(200), 150);
    expect(result).toHaveLength(150);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('fallbackExcerpt', () => {
  it('リード文の最初の 1 文だけを使う (2 文目以降のノベルティ名を入れない)', () => {
    expect(fallbackExcerpt(LEAD, 'タイトル')).toBe(
      '人気作品「名探偵コナン」× 東京・神奈川・愛知・大阪・宮城・北海道の各会場にて2026年4月10日〜8月2日までコラボカフェが開催される。'
    );
  });

  it('最初の 1 文が上限を超えれば切り詰める', () => {
    const result = fallbackExcerpt(LEAD, 'タイトル', 60);
    expect(result).toHaveLength(60);
    expect(result.startsWith('人気作品「名探偵コナン」× 東京・神奈川')).toBe(true);
  });
});

describe('fallbackExcerpt (境界)', () => {
  it('括弧の中の「。」では切らない (「モーニング娘。」など)', () => {
    expect(fallbackExcerpt("人気グループ「モーニング娘。'26」のコラボカフェが開催される。次の文。", 't')).toBe(
      "人気グループ「モーニング娘。'26」のコラボカフェが開催される。"
    );
  });

  it('リード文が空ならタイトルを使う (抜粋は空にできない)', () => {
    expect(fallbackExcerpt('<moreads></moreads>', '名探偵コナン カフェ')).toBe('名探偵コナン カフェ');
  });
});

describe('ExcerptGenerationService', () => {
  it('タイトル・リード文・枠の行・上限をプロンプトに入れ、整えた抜粋とコストの材料を返す', async () => {
    const { service, sendMessage } = build('{"excerpt": "\\"名探偵コナン\\"のコラボカフェが10会場で開催"}');

    const result = await service.generate({
      title: '名探偵コナン カフェ in 6都市',
      作品名: '名探偵コナン',
      leadMdx: LEAD,
      pointsBlock: POINTS,
    });

    expect(result).toEqual({
      excerpt: '「名探偵コナン」のコラボカフェが10会場で開催',
      model: 'test-model',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const [prompt, options] = sendMessage.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(prompt).toContain('T=名探偵コナン カフェ in 6都市');
    expect(prompt).toContain('作品=名探偵コナン');
    expect(prompt).toContain('L=人気作品「名探偵コナン」× 東京');
    expect(prompt).toContain('- 2026年4月10日〜8月2日、東京・神奈川・愛知・大阪・宮城・北海道の10会場\n- 描き下ろしイラストを使用');
    // 上限 160 字を、20 字少なく伝える (LLM が字数を数え違えても、切り詰めずに済むように)
    expect(prompt).toContain('上限=140');
    expect(options).toMatchObject({ stepId: 'excerpt-generation', responseFormat: 'json' });
  });

  it('リード文の中の {{points}} などの文字列は展開しない (1 回で置き換える)', async () => {
    const { service, sendMessage } = build('{"excerpt": "抜粋"}');

    await service.generate({ title: 't', 作品名: null, leadMdx: '本文に {{points}} とある', pointsBlock: '' });

    const [prompt] = sendMessage.mock.calls[0] as unknown as [string];
    expect(prompt).toContain('L=本文に {{points}} とある');
    expect(prompt).toContain('作品=(不明)');
    expect(prompt).toContain('P=\n(なし)');
    // 既定の上限は 160 字 (constraints.yaml)。プロンプトには 140 字と伝える
    expect(prompt).toContain('上限=140');
  });

  it('応答を読めない・空なら、usage 付きの ExcerptParseError (コストを記録できる)', async () => {
    for (const content of ['JSON ではない', '{"summary": "x"}', '{"excerpt": "  "}']) {
      const { service } = build(content);
      const error = await service.generate({ title: 't', 作品名: null, leadMdx: LEAD, pointsBlock: '' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ExcerptParseError);
      expect((error as ExcerptParseError).usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    }
  });

  it('プロンプトが無ければ、キー名を挙げて ExcerptPromptMissingError (呼び出し側が通知する)', async () => {
    const { service } = build('{"excerpt": "x"}', { prompts: {} });
    const error = await service.generate({ title: 't', 作品名: null, leadMdx: LEAD, pointsBlock: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExcerptPromptMissingError);
    expect((error as Error).message).toContain('6-meta-description.yaml に prompts.write_excerpt がありません');
  });
});
