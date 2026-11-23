/**
 * img 要素の画像の URL (公式ページの HTML から画像を拾う処理で共通に使う)
 */

/**
 * 壊れた src を直す。閉じ引用符の無い `src="img/a.jpg?0></a>...<font size="` のような値は、続く HTML が
 * 属性の値に入り込む (1 ページ構成の公式サイトで実例あり)。`<` か `>` の手前で切る。空白では切らない
 * (ファイル名に空白を含む画像がある: `BANANA RUSH.jpg`。ブラウザは空白をエンコードして読む)
 */
export function repairImageSrc(src: string): string {
  const cut = src.search(/[<>]/);
  return cut === -1 ? src : src.slice(0, cut).trimEnd();
}

/**
 * img の画像の URL。遅延読み込みのサイトは src に 1×1 のダミー (`data:image/gif;base64,…`) を置き、
 * 本物を data-src / data-lazy-src に持つので、data: でないものを使う (conan-cafe.jp)。data: しか無ければ画像として扱わない
 */
export function imageSource(element: { attr(name: string): string | undefined }): string | undefined {
  const candidates = [element.attr('src'), element.attr('data-src'), element.attr('data-lazy-src')]
    .map((value) => (value === undefined ? undefined : repairImageSrc(value.trim())))
    .filter((value): value is string => !!value);
  return candidates.find((value) => !/^data:/i.test(value));
}
