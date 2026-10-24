/**
 * Layer 1: 公式サイトの著作権表記と、原作者名の根拠の照合 (`lib/utils/copyright-notices.ts`)
 */
import { describe, expect, it } from '@jest/globals';
import { extractCopyrightNotices, keepSupportedAuthors } from '@/lib/utils/copyright-notices';

describe('extractCopyrightNotices', () => {
  it('JavaScript の文字列の中の表記を読む (ヒロアカ)', () => {
    const html = "<script>\n        const newText = '©堀越耕平／集英社・僕のヒーローアカデミア製作委員会';\n</script>";
    expect(extractCopyrightNotices(html)).toEqual(['©堀越耕平／集英社・僕のヒーローアカデミア製作委員会']);
  });

  it('フッターの表記を読み、タグの手前で止める (コナン)', () => {
    const html = '<footer><address>©青山剛昌／小学館・読売テレビ・TMS 1996</address></footer>';
    expect(extractCopyrightNotices(html)).toEqual(['©青山剛昌／小学館・読売テレビ・TMS 1996']);
  });

  it('実体参照と JS のエスケープも読み、重複を除く (大文字小文字は問わない)', () => {
    const html =
      '<p>&copy; 芥見下々/集英社</p><p>&#169;芥見下々/集英社</p><script>"\\u00a9 PEACH-PIT/講談社"</script><p>&#xa9;CLAMP/講談社</p><p>&COPY;ONE/集英社</p>';
    expect(extractCopyrightNotices(html)).toEqual(['©芥見下々/集英社', '©PEACH-PIT/講談社', '©CLAMP/講談社', '©ONE/集英社']);
  });

  it('年だけの表記は名前を持たないので読まない', () => {
    expect(extractCopyrightNotices('<small>© 2026</small><small>©2020-2026.</small>')).toEqual([]);
  });

  it('権利者の区切りを含む表記を先にして 5 件に絞る (前にある © が多くても、フッターの作品の表記を落とさない)', () => {
    const html =
      Array.from({ length: 6 }, (_, i) => `<p>©Example Corp ${i}</p>`).join('') + '<footer>©青山剛昌／小学館</footer>';
    const notices = extractCopyrightNotices(html);
    expect(notices).toHaveLength(5);
    expect(notices[0]).toBe('©青山剛昌／小学館');
  });

  it('5 件までに抑える', () => {
    const html = Array.from({ length: 8 }, (_, i) => `<p>©作者${i}/出版社</p>`).join('');
    expect(extractCopyrightNotices(html)).toHaveLength(5);
  });
});

describe('keepSupportedAuthors', () => {
  const notices = ['©堀越耕平／集英社・僕のヒーローアカデミア製作委員会'];

  it('著作権表記にある名前は残す (敬称と空白は無視する)', () => {
    expect(keepSupportedAuthors('堀越耕平先生', { notices, pageText: '' })).toEqual({ 原作者名: '堀越耕平先生', dropped: [] });
    expect(keepSupportedAuthors('堀越 耕平先生', { notices, pageText: '' })).toEqual({ 原作者名: '堀越 耕平先生', dropped: [] });
  });

  it('著作権表記にも本文にも無い名前は外す (LLM が知識で補った名前)', () => {
    expect(keepSupportedAuthors('堀越耕平先生', { notices: [], pageText: '<p>コラボカフェ開催</p>' })).toEqual({
      原作者名: null,
      dropped: ['堀越耕平先生'],
    });
  });

  it('本文に書かれている名前は残す', () => {
    expect(keepSupportedAuthors('尾田栄一郎先生', { notices: [], pageText: '<p>原作：尾田栄一郎</p>' })).toEqual({
      原作者名: '尾田栄一郎先生',
      dropped: [],
    });
  });

  it('配列は根拠のある名前だけ残し、配列のまま返す', () => {
    expect(keepSupportedAuthors(['CLAMP先生', '新條まゆ先生'], { notices: ['©CLAMP・ShigatsuTsuitachi CO.,LTD./講談社'], pageText: '' })).toEqual({
      原作者名: ['CLAMP先生'],
      dropped: ['新條まゆ先生'],
    });
  });

  it('大文字小文字を問わない (©Clamp と CLAMP先生)', () => {
    expect(keepSupportedAuthors('CLAMP先生', { notices: ['©Clamp/講談社'], pageText: '' }).dropped).toEqual([]);
  });

  it('3 文字未満の名前は著作権表記の中だけで照合する (本文のたまたまの一致で通さない)', () => {
    expect(keepSupportedAuthors('ONE先生', { notices: [], pageText: '<p>ONE PIECE ほか</p>' }).dropped).toEqual([]);
    expect(keepSupportedAuthors('じん先生', { notices: [], pageText: '<p>おじんじゃ</p>' }).dropped).toEqual(['じん先生']);
    expect(keepSupportedAuthors('じん先生', { notices: ['©じん／KADOKAWA'], pageText: '' }).dropped).toEqual([]);
  });

  it('null・undefined はそのまま null', () => {
    expect(keepSupportedAuthors(null, { notices, pageText: '' })).toEqual({ 原作者名: null, dropped: [] });
    expect(keepSupportedAuthors(undefined, { notices, pageText: '' })).toEqual({ 原作者名: null, dropped: [] });
  });
});
