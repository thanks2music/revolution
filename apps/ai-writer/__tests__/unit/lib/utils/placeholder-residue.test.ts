import { describe, expect, it } from '@jest/globals';

import {
  findUnreplacedPlaceholders,
  removeImagePlaceholderLines,
} from '@/lib/utils/placeholder-residue';

describe('findUnreplacedPlaceholders', () => {
  it('置換済みの本文では何も返さない', () => {
    expect(findUnreplacedPlaceholders('全12種類がラインアップ!')).toEqual([]);
  });

  it('テキストプレースホルダーを検出する', () => {
    expect(findUnreplacedPlaceholders('全{{メニュー種類数}}種類がラインアップ!')).toEqual([
      '{{メニュー種類数}}',
    ]);
  });

  it('ドット記法のプレースホルダーも検出する', () => {
    expect(findUnreplacedPlaceholders('{{開催期間.開始.年}}より開催')).toEqual([
      '{{開催期間.開始.年}}',
    ]);
  });

  it('画像プレースホルダーを検出する', () => {
    expect(findUnreplacedPlaceholders('{ここに記事アイキャッチの画像を入れる}')).toEqual([
      '{ここに記事アイキャッチの画像を入れる}',
    ]);
  });

  it('重複は 1 件に畳む', () => {
    const content = '{{ノベルティ名}} と {{ノベルティ名}}';
    expect(findUnreplacedPlaceholders(content)).toEqual(['{{ノベルティ名}}']);
  });

  it('テキストと画像が混在していても両方返す', () => {
    const content = '全{{メニュー種類数}}種類\n\n{ここにメニューの画像を入れる}';
    expect(findUnreplacedPlaceholders(content)).toEqual([
      '{{メニュー種類数}}',
      '{ここにメニューの画像を入れる}',
    ]);
  });

  // ★ 本文がコードを含む場合の誤検出を防ぐ。コラボカフェ記事では稀だが、
  //   誤検出は「正常な記事を skip する」方向に効くので明示的に固定する。
  it('コードフェンス内は検出しない', () => {
    const content = ['説明文', '```ts', 'const x = {{a: 1}};', '```', '本文'].join('\n');
    expect(findUnreplacedPlaceholders(content)).toEqual([]);
  });

  it('インラインコード内は検出しない', () => {
    expect(findUnreplacedPlaceholders('記法は `{{変数}}` を使う')).toEqual([]);
  });

  it('複数行にまたがる波括弧は検出しない (JSX ブロック等の誤検出回避)', () => {
    expect(findUnreplacedPlaceholders('{{\nfoo\n}}')).toEqual([]);
  });
});

describe('removeImagePlaceholderLines', () => {
  it('画像プレースホルダーだけの行を除去する', () => {
    const content = ['## 見出し', '', '{ここに記事アイキャッチの画像を入れる}', '', '本文'].join(
      '\n'
    );
    expect(removeImagePlaceholderLines(content)).toBe('## 見出し\n\n本文');
  });

  it('前後にスペースがあっても除去する', () => {
    expect(removeImagePlaceholderLines('  {ここにメニューの画像を入れる}  ')).toBe('');
  });

  it('行内に本文が混在する場合は行を消さずプレースホルダーだけ取り除く', () => {
    expect(removeImagePlaceholderLines('メニュー {ここにメニューの画像を入れる} の紹介')).toBe(
      'メニュー  の紹介'
    );
  });

  it('画像プレースホルダーが無ければ本文を変えない', () => {
    const content = '## 見出し\n\n本文';
    expect(removeImagePlaceholderLines(content)).toBe(content);
  });

  // テキストプレースホルダーは文の途中に埋まっており、機械的に消すと
  // 日本語の係り受けが壊れる。除去対象は画像だけであることを固定する。
  it('テキストプレースホルダーには触れない', () => {
    const content = 'ノベルティー「{{ノベルティ名}}」がプレゼントされる。';
    expect(removeImagePlaceholderLines(content)).toBe(content);
  });

  it('除去で生じた連続空行を 1 つに畳む', () => {
    const content = ['本文A', '', '{ここに画像を入れる}', '', '本文B'].join('\n');
    expect(removeImagePlaceholderLines(content)).toBe('本文A\n\n本文B');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 回帰テスト: 2026-08-15 の実走で 9 本中 7 本に混入した実データを再現する。
//
// MDX では {{...}} / {...} が JSX 式として評価されるため ReferenceError に
// ならず「静かに消える」。ページは 200 で描画されコンソールエラーも 0 件の
// まま、読者にだけ壊れた日本語が見えていた。検知できることを固定する。
// ────────────────────────────────────────────────────────────────────────────
describe('実走で混入した実データ (回帰)', () => {
  const actualLead =
    '「ブルーロック」コラボカフェでは、作品の世界観やキャラクターをイメージした' +
    'コラボメニューがお楽しみいただける他、メニューを注文の方には「ブルーロック」' +
    'カフェ限定のノベルティー「{{ノベルティ名}}」がランダムに1枚プレゼントされる。';

  const actualMenu =
    '「ブルーロック × BOX cafe&space GEMS渋谷店」では、第1期に登場するキャラクターを' +
    'イメージしたフードやデザート、キャラクターカラーのドリンクなどのメニューをご用意。' +
    '潔世一、蜂楽廻、絵心甚八らをイメージした全{{メニュー種類数}}種類がラインアップ!';

  it('リード文の {{ノベルティ名}} を検出する', () => {
    expect(findUnreplacedPlaceholders(actualLead)).toEqual(['{{ノベルティ名}}']);
  });

  it('メニュー文の {{メニュー種類数}} を検出する', () => {
    expect(findUnreplacedPlaceholders(actualMenu)).toEqual(['{{メニュー種類数}}']);
  });

  it('記事全体 (アイキャッチ含む) で 3 件すべて検出する', () => {
    const article = [actualLead, '', actualMenu, '', '{ここに記事アイキャッチの画像を入れる}'].join(
      '\n'
    );
    expect(findUnreplacedPlaceholders(article)).toEqual([
      '{{ノベルティ名}}',
      '{{メニュー種類数}}',
      '{ここに記事アイキャッチの画像を入れる}',
    ]);
  });

  it('画像だけを除去してもテキスト 2 件は残る (= 記事は skip されるべき)', () => {
    const article = [actualLead, '', actualMenu, '', '{ここに記事アイキャッチの画像を入れる}'].join(
      '\n'
    );
    const cleaned = removeImagePlaceholderLines(article);

    expect(findUnreplacedPlaceholders(cleaned)).toEqual([
      '{{ノベルティ名}}',
      '{{メニュー種類数}}',
    ]);
  });

  it('テンプレート修正後の想定出力は検出ゼロになる', () => {
    // {{#if ノベルティ名}} で囲んだ結果、ノベルティ一文が落ちた形
    const fixedLead =
      '「ブルーロック」コラボカフェでは、作品の世界観やキャラクターをイメージした' +
      'コラボメニューがお楽しみいただける。';
    // {{#if メニュー種類数}}...{{else}}コラボメニュー{{/if}} が else へ倒れた形
    const fixedMenu =
      '「ブルーロック × BOX cafe&space GEMS渋谷店」では、' +
      '潔世一、蜂楽廻、絵心甚八らをイメージしたコラボメニューがラインアップ!';

    expect(findUnreplacedPlaceholders(`${fixedLead}\n\n${fixedMenu}`)).toEqual([]);
  });
});
