/**
 * @fileoverview 未置換プレースホルダーの検出と除去 (Layer 1: 純粋関数)
 *
 * @description
 * テンプレート由来のプレースホルダーが置換されずに最終 MDX へ残る事故を止める。
 *
 * ## なぜ必要か
 *
 * **MDX では `{{...}}` / `{...}` が JSX 式として評価される。** 値が無くても
 * ReferenceError にはならず「静かに消える」ため、ページは 200 で描画され
 * コンソールエラーも 0 件のまま、読者にだけ壊れた文が見える。
 *
 * ```
 * MDX:   ノベルティー「{{ノベルティ名}}」がランダムに1枚プレゼントされる。
 * 描画:  ノベルティー「」がランダムに1枚プレゼントされる。       ← 鉤括弧が空
 * ```
 *
 * 2026-08-15 の実走では 9 本中 7 本にこれが混入していた。既存の
 * `text-placeholder-replacement` / `image-placeholder-replacement` は
 * **警告は出すが除去も停止もしない**ため、最終段での検査が要る。
 *
 * ## テキストと画像で扱いが違う理由
 *
 * - **テキスト** (`{{...}}`): 文の途中に埋まっているため、機械的に消すと
 *   日本語の係り受けが壊れる (「ノベルティー「」が〜」の文ごと消すと特典の
 *   記載が失われる)。→ **除去せず検出のみ**し、呼び出し側が記事を skip する
 * - **画像** (`{ここに〜画像を入れる}`): 独立行として置かれる規約なので、
 *   行ごと消しても文は壊れない。→ **除去する**
 */

/** テキストプレースホルダー: `{{作品名}}` `{{開催期間.開始.年}}` など。 */
const TEXT_PLACEHOLDER_PATTERN = /\{\{[^{}\n]+\}\}/g;

/**
 * 画像プレースホルダー: `{ここに記事アイキャッチの画像を入れる}` など。
 *
 * Templates 側の規約 (`CLAUDE.md` の「HTML 構造の保持」) で
 * `{ここに〜を入れる}` の形に統一されている。
 */
const IMAGE_PLACEHOLDER_PATTERN = /\{ここに[^{}\n]*\}/g;

/**
 * コードブロック・インラインコードを空白へ潰す。
 *
 * 記事本文が波括弧を含むコードを載せた場合に誤検出しないための前処理。
 * **位置をずらさないよう同じ長さの空白で置換する** (行番号や抜粋位置の
 * 手がかりを壊さないため)。
 */
function maskCodeSpans(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * 未置換プレースホルダーを列挙する (重複は除去、出現順を維持)。
 *
 * @param content - 置換処理をすべて終えた MDX 本文
 * @returns 見つかったプレースホルダー文字列。無ければ空配列
 *
 * @example
 * findUnreplacedPlaceholders('全{{メニュー種類数}}種類')  // → ['{{メニュー種類数}}']
 * findUnreplacedPlaceholders('全12種類')                  // → []
 */
export function findUnreplacedPlaceholders(content: string): string[] {
  const masked = maskCodeSpans(content);
  const found = [
    ...(masked.match(TEXT_PLACEHOLDER_PATTERN) ?? []),
    ...(masked.match(IMAGE_PLACEHOLDER_PATTERN) ?? []),
  ];
  return [...new Set(found)];
}

/**
 * 未置換の画像プレースホルダーを**行ごと**除去する。
 *
 * 画像が取得できなかった場合に `{ここに記事アイキャッチの画像を入れる}` が
 * 本文へ露出するのを防ぐ。行内に他の文字がある場合は行を消さず、
 * プレースホルダー部分だけを取り除く (誤って本文を消さないため)。
 *
 * @param content - `image-placeholder-replacement` を終えた MDX 本文
 * @returns 画像プレースホルダーを除いた本文
 */
export function removeImagePlaceholderLines(content: string): string {
  const withoutPlaceholderOnlyLines = content
    .split('\n')
    .filter((line) => !/^\s*\{ここに[^{}\n]*\}\s*$/.test(line))
    .join('\n');

  // 行内に混在しているケースの取りこぼしを拾う (規約外だが防御的に)
  const cleaned = withoutPlaceholderOnlyLines.replace(IMAGE_PLACEHOLDER_PATTERN, '');

  // 除去で生じた連続空行を整理する (removeFooterPlaceholder と同じ方針)
  return cleaned.replace(/\n{3,}/g, '\n\n');
}
