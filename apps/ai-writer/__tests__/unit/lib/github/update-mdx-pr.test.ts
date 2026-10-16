/**
 * Layer 2: 公開中の記事の更新の GitHub 側 (main からの読み込み、sha を指定した上書きと PR)
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// @octokit/rest は ESM のため import 評価を止め、クライアントを差し替える
jest.mock('@/lib/github/client', () => ({
  createGitHubClient: jest.fn(),
  REPO_CONFIG: { owner: 'owner', repo: 'repo', baseBranch: 'main', contentBasePath: 'content' },
  SERVICE_ACCOUNT_COMMITTER: { name: 'Revolution AI Writer', email: 'ai-writer@revolution.example.com' },
  wrapNetworkError: (error: unknown) => {
    throw new Error(`wrapped: ${(error as Error).message}`);
  },
}));

const { createGitHubClient } = require('@/lib/github/client') as { createGitHubClient: jest.Mock };
const { fetchArticleFromMain, createUpdateMdxPr } = require('@/lib/github/update-mdx-pr') as typeof import('@/lib/github/update-mdx-pr');
const { BranchConflictError, GitHubAuthError } = require('@/lib/errors/github') as typeof import('@/lib/errors/github');

const POST_ID = '01m4s065g1hchh9d';
const MDX = '---\npost_id: "01m4s065g1hchh9d"\n---\n本文\n';

function fakeOctokit() {
  return {
    git: {
      getTree: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        data: {
          truncated: false,
          tree: [
            { type: 'tree', path: 'collabo-cafe' },
            { type: 'blob', path: 'collabo-cafe/blue-lock/01m02zah3mp8jwf7.mdx' },
            { type: 'blob', path: `collabo-cafe/my-hero-academia/${POST_ID}.mdx` },
          ],
        },
      }),
      getRef: jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: { object: { sha: 'base-sha' } } }),
      createRef: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    repos: {
      getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        data: { type: 'file', sha: 'blob-sha', encoding: 'base64', content: Buffer.from(MDX).toString('base64') },
      }),
      createOrUpdateFileContents: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ data: { commit: { sha: 'commit-sha' } } }),
    },
    pulls: {
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: { number: 400, html_url: 'https://github.com/owner/repo/pull/400' } }),
    },
  };
}

let octokit: ReturnType<typeof fakeOctokit>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  octokit = fakeOctokit();
  createGitHubClient.mockResolvedValue(octokit as never);
});

describe('fetchArticleFromMain', () => {
  it('main の記事のフォルダの木から post_id の記事を探し、中身と sha を返す', async () => {
    const article = await fetchArticleFromMain(POST_ID);

    expect(octokit.git.getTree).toHaveBeenCalledWith(
      expect.objectContaining({ tree_sha: 'main:apps/ai-writer/content', recursive: 'true' }),
    );
    expect(octokit.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: `apps/ai-writer/content/collabo-cafe/my-hero-academia/${POST_ID}.mdx`, ref: 'main' }),
    );
    expect(article).toEqual({
      path: `apps/ai-writer/content/collabo-cafe/my-hero-academia/${POST_ID}.mdx`,
      sha: 'blob-sha',
      content: MDX,
    });
  });

  it('記事が無ければ例外', async () => {
    await expect(fetchArticleFromMain('01m4s065g1hchh9x')).rejects.toThrow('main に post_id 01m4s065g1hchh9x の記事がありません');
  });

  it('同じ post_id の記事が 2 つあれば例外 (どちらを更新するか決められない)', async () => {
    octokit.git.getTree.mockResolvedValueOnce({
      data: {
        truncated: false,
        tree: [
          { type: 'blob', path: `collabo-cafe/a/${POST_ID}.mdx` },
          { type: 'blob', path: `popup-store/b/${POST_ID}.mdx` },
        ],
      },
    });
    await expect(fetchArticleFromMain(POST_ID)).rejects.toThrow('2 つあります');
  });

  it('一覧が切り詰められたら例外 (見落としを避ける)', async () => {
    octokit.git.getTree.mockResolvedValueOnce({ data: { truncated: true, tree: [] } });
    await expect(fetchArticleFromMain(POST_ID)).rejects.toThrow('切り詰められました');
  });

  it('post_id の形が違えば GitHub を呼ばない (パスに使うため)', async () => {
    await expect(fetchArticleFromMain('../secret')).rejects.toThrow('post_id の形が正しくありません');
    expect(createGitHubClient).not.toHaveBeenCalled();
  });

  it('401 / 403 は GitHubAuthError', async () => {
    octokit.git.getTree.mockRejectedValueOnce(Object.assign(new Error('Bad credentials'), { status: 401 }));
    await expect(fetchArticleFromMain(POST_ID)).rejects.toBeInstanceOf(GitHubAuthError);
  });
});

describe('createUpdateMdxPr', () => {
  const params = {
    mdxContent: '---\nupdated: "x"\n---\n新しい本文\n',
    filePath: `apps/ai-writer/content/collabo-cafe/my-hero-academia/${POST_ID}.mdx`,
    sha: 'blob-sha',
    title: '♻️ Update article (AI Writer): collabo-cafe/01m4s065g1hchh9d',
    body: '本文',
    branchName: 'ai-writer/update-collabo-cafe-01m4s065g1hchh9d-20261017-063000',
    commitMessage: '♻️ Update article: タイトル',
  };

  it('main から新しいブランチを作り、sha を指定して上書きし、PR を作る', async () => {
    const result = await createUpdateMdxPr(params);

    expect(octokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: `refs/heads/${params.branchName}`, sha: 'base-sha' }),
    );
    expect(octokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: params.filePath,
        sha: 'blob-sha',
        branch: params.branchName,
        message: params.commitMessage,
        content: Buffer.from(params.mdxContent).toString('base64'),
      }),
    );
    expect(octokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: params.title, head: params.branchName, base: 'main' }),
    );
    expect(result).toEqual({
      prNumber: 400,
      prUrl: 'https://github.com/owner/repo/pull/400',
      branchName: params.branchName,
      commitSha: 'commit-sha',
    });
  });

  it('読んだ後に main の記事が変わっていたら (409) 上書きせず、PR を作らない', async () => {
    octokit.repos.createOrUpdateFileContents.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));

    await expect(createUpdateMdxPr(params)).rejects.toThrow('main の');
    expect(octokit.pulls.create).not.toHaveBeenCalled();
  });

  it('同じ名前のブランチがあれば BranchConflictError', async () => {
    octokit.git.createRef.mockRejectedValueOnce(
      Object.assign(new Error('Reference already exists'), { status: 422 }),
    );
    await expect(createUpdateMdxPr(params)).rejects.toBeInstanceOf(BranchConflictError);
    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('PR の作成の失敗 (500 など) はネットワークのエラーに包む', async () => {
    octokit.pulls.create.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }));
    await expect(createUpdateMdxPr(params)).rejects.toThrow('wrapped: Server Error');
  });
});
