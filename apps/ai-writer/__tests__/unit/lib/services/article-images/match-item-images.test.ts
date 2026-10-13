/**
 * Layer 1: 画像の代替テキストと品名の照合 (`match-item-images.ts`、2026-10-13)。
 */
import { itemNameKey } from '@/lib/services/merge-subpage-into-extraction';
import { altKeys, matchImagesToItems } from '@/lib/services/article-images/match-item-images';

const img = (alt: string | null, id = alt ?? '-') => ({ alt, id });

describe('altKeys', () => {
  it('「2枚目_」などの _ までの接頭辞と、品名の前の英字を外した形も候補にする', () => {
    expect(altKeys('2枚目_缶バッジ')).toContain(itemNameKey('缶バッジ'));
    expect(altKeys('0427～_後期_アクリルスタンド')).toContain(itemNameKey('アクリルスタンド'));
    expect(altKeys('badge缶バッジ')).toContain(itemNameKey('缶バッジ'));
  });

  it('元の代替テキストそのものも候補に残す (品名に英字・_ を含むもののため)', () => {
    expect(altKeys('T_シャツ')).toContain(itemNameKey('T_シャツ'));
  });
});

describe('matchImagesToItems', () => {
  it('表記の揺れと末尾の種類数の注記を無視して照合し、元の順で品目に振り分ける', () => {
    const images = [
      img('アクリルスタンド'),
      img('2枚目_缶バッジ（全7種）'),
      img('缶バッジ', 'badge-2'),
      img('店内の様子'),
      img(null),
    ];

    const { byItem, rest } = matchImagesToItems(['缶バッジ（全7種）', 'アクリルスタンド', 'ステッカー'], images);

    expect(byItem.map((list) => list.map((i) => i.id))).toEqual([
      ['2枚目_缶バッジ（全7種）', 'badge-2'],
      ['アクリルスタンド'],
      [],
    ]);
    expect(rest.map((i) => i.id)).toEqual(['店内の様子', '-']);
  });

  it('同じキーの品目が複数あれば先の品目にだけ付ける (1 枚の画像を 2 品目に付けない)', () => {
    const { byItem } = matchImagesToItems(['缶バッジ', '缶バッジ（全7種）'], [img('缶バッジ')]);
    expect(byItem.map((list) => list.length)).toEqual([1, 0]);
  });

  it('品名と代替テキストの片方にだけ副題があっても照合する。そのままの形で一致する品目を優先する', () => {
    const { byItem, rest } = matchImagesToItems(
      ['天使VS堕天使ドリンク――振り落とされるなよ、少年――', '風の女神ドリンク', '風の女神ドリンク～限定～'],
      [img('天使VS堕天使ドリンク'), img('風の女神ドリンク ――旋風を、巻き起こせ――'), img('風の女神ドリンク～限定～')]
    );

    expect(byItem.map((list) => list.map((i) => i.id))).toEqual([
      ['天使VS堕天使ドリンク'],
      ['風の女神ドリンク ――旋風を、巻き起こせ――'],
      ['風の女神ドリンク～限定～'],
    ]);
    expect(rest).toEqual([]);
  });

  it('副題は末尾で囲まれたものだけ外す (途中の ～…～ は品名の一部)', () => {
    const { byItem, rest } = matchImagesToItems(
      ['炭治郎～水の呼吸～パフェ', 'ナポリタン～風の女神～'],
      [img('炭治郎'), img('ナポリタン'), img('0427～_後期_ナポリタン～風の女神～')]
    );

    expect(byItem.map((list) => list.map((i) => i.id))).toEqual([[], ['ナポリタン', '0427～_後期_ナポリタン～風の女神～']]);
    expect(rest.map((i) => i.id)).toEqual(['炭治郎']);
  });

  it('両方に別の副題があれば結びつけない。副題を外した形が複数の品目で同じなら、その形では結びつけない', () => {
    const { byItem, rest } = matchImagesToItems(
      ['ドリンク～A～', 'ドリンク～B～', 'パフェ～春～'],
      [img('ドリンク'), img('パフェ～夏～')]
    );

    expect(byItem.every((list) => list.length === 0)).toBe(true);
    expect(rest.map((i) => i.id)).toEqual(['ドリンク', 'パフェ～夏～']);
  });

  it('品目が無ければ全部 rest', () => {
    expect(matchImagesToItems([], [img('缶バッジ')]).rest).toHaveLength(1);
  });
});
