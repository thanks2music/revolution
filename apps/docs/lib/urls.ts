import path from 'node:path';

// サイトのページと repo 内のファイルの対応づけ。どれも純関数 (テスト: __tests__/unit/lib/urls.test.ts)。

export const REPO_URL = 'https://github.com/thanks2music/revolution';
const REPO_BLOB_URL = `${REPO_URL}/blob/main`;
const CONTENT_DIR = 'docs';

/**
 * docs/README.md は GitHub 上の目次を兼ねるので、サイトでもトップ (/) にする。
 * それ以外は Fumadocs の既定 (ファイル名) に任せる (undefined)。
 */
export function docsSlugs(filePath: string): string[] | undefined {
  return filePath === 'README.md' ? [] : undefined;
}

/** Markdown 版の URL のパス (拡張子なし)。トップは公式の例と同じく index にする。 */
export function markdownSegments(slugs: string[]): string[] {
  return slugs.length === 0 ? ['index'] : slugs;
}

/** ページの Markdown 版の URL (/<page>.md、トップは /index.md)。 */
export function markdownUrl(slugs: string[]): string {
  return `/${markdownSegments(slugs).join('/')}.md`;
}

/** markdownSegments の逆。/index.md で来たリクエストをトップのページに戻す。 */
export function slugsFromMarkdownUrl(segments: string[]): string[] {
  return segments.length === 1 && segments[0] === 'index' ? [] : segments;
}

/** ページの元ファイルの GitHub 上の URL。pagePath は docs/ からの相対パス。 */
export function githubUrl(pagePath: string): string {
  return `${REPO_BLOB_URL}/${CONTENT_DIR}/${pagePath}`;
}

/**
 * サイトに載らないファイルへの相対リンクを、GitHub 上のファイルの URL に変える
 * (../apps/... や除外した archive/ など。サイト上ではリンク切れになるため)。
 * 相対リンクでないもの・repo の外を指すものは undefined。
 */
export function toRepoBlobUrl(pagePath: string, href: string): string | undefined {
  if (!href.startsWith('./') && !href.startsWith('../')) return undefined;

  const [target, hash] = href.split('#', 2);
  const repoPath = path.posix.join(CONTENT_DIR, path.posix.dirname(pagePath), target);
  if (repoPath === '..' || repoPath.startsWith('../')) return undefined;

  const anchor = hash ? `#${hash}` : '';
  if (repoPath === '.' || repoPath === './') return `${REPO_URL}${anchor}`;
  return `${REPO_BLOB_URL}/${repoPath}${anchor}`;
}

/**
 * 本文中のリンクの行き先を決める。siteHref は Fumadocs が相対リンクを解決した結果で、
 * サイトのページに当たらなかった時は href のまま返ってくる。
 * サイトのページならその URL、サイトに載らないファイルなら GitHub 上の URL、それ以外は href のまま。
 */
export function pickDocsHref(href: string, pagePath: string, siteHref: string): string {
  if (siteHref !== href) return siteHref;
  return toRepoBlobUrl(pagePath, href) ?? href;
}

/** 先頭の YAML frontmatter (--- で囲んだ部分) を取り除く。 */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /(\]\()(\.{1,2}\/[^)\s]*)/g;

/**
 * Markdown のインラインのリンク・画像 `[..](./x)` / `![..](../x)` の相対パスを rewrite で書き換える。
 * フェンスで囲んだコードブロックの中は書き換えない。
 */
export function rewriteRelativeLinks(markdown: string, rewrite: (href: string) => string): string {
  let fence: string | undefined;

  return markdown
    .split('\n')
    .map(line => {
      const marker = FENCE.exec(line)?.[1];
      if (marker) {
        // 閉じるのは、開いた時と同じ文字で同じ数以上並んだ行 (CommonMark)
        if (fence === undefined) fence = marker;
        else if (marker.startsWith(fence)) fence = undefined;
        return line;
      }
      if (fence !== undefined) return line;
      return line.replace(INLINE_LINK, (_, open: string, href: string) => `${open}${rewrite(href)}`);
    })
    .join('\n');
}
