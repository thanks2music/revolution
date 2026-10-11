import path from 'node:path';

// サイトのページと repo 内のファイルの対応づけ。どれも純関数 (テスト: __tests__/unit/lib/urls.test.ts)。

const REPO_BLOB_URL = 'https://github.com/thanks2music/revolution/blob/main';
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
  const repoPath = path.posix.normalize(
    path.posix.join(CONTENT_DIR, path.posix.dirname(pagePath), target)
  );
  if (repoPath.startsWith('../')) return undefined;

  return `${REPO_BLOB_URL}/${repoPath}${hash ? `#${hash}` : ''}`;
}
