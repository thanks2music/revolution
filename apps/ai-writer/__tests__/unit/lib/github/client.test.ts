/**
 * createGitHubClient がどの PAT で Octokit を作るか (env → Secret Manager の配線)。
 * octokit は ESM のため、モジュールごと差し替える。
 */
const octokitOptions: Array<{ auth?: string }> = [];
const accessSecretVersion = jest.fn();

jest.mock('@octokit/rest', () => ({
  Octokit: {
    plugin: () =>
      class {
        constructor(options: { auth?: string }) {
          octokitOptions.push(options);
        }
      },
  },
}));
jest.mock('@octokit/plugin-retry', () => ({ retry: {} }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: {} }));
jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({ accessSecretVersion })),
}));

import { clearPatCache, createGitHubClient } from '@/lib/github/client';
import { GitHubAuthError } from '@/lib/errors/github';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.REVO_GITHUB_PAT;
  delete process.env.GITHUB_PAT;
  octokitOptions.length = 0;
  accessSecretVersion.mockReset();
  clearPatCache();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

describe('createGitHubClient PAT selection', () => {
  it('uses REVO_GITHUB_PAT over a shell-wide GITHUB_PAT', async () => {
    process.env.REVO_GITHUB_PAT = 'revo-token';
    process.env.GITHUB_PAT = 'stale-shell-token';

    await createGitHubClient();

    expect(octokitOptions[0].auth).toBe('revo-token');
    expect(accessSecretVersion).not.toHaveBeenCalled();
  });

  it('throws without falling back when REVO_GITHUB_PAT is an unresolved op:// reference', async () => {
    process.env.REVO_GITHUB_PAT = 'op://vault/item/credential';
    process.env.GITHUB_PAT = 'stale-shell-token';

    await expect(createGitHubClient()).rejects.toThrow(GitHubAuthError);
    expect(octokitOptions).toHaveLength(0);
    expect(accessSecretVersion).not.toHaveBeenCalled();
  });

  it('reads Secret Manager when neither variable has a value (Cloud Run path unchanged)', async () => {
    process.env.REVO_GITHUB_PAT = '  ';
    accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from('secret-token') } }]);

    await createGitHubClient();

    expect(accessSecretVersion).toHaveBeenCalledTimes(1);
    expect(octokitOptions[0].auth).toBe('secret-token');
  });
});
