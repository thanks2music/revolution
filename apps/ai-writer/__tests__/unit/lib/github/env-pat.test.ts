import { resolveEnvPat } from '@/lib/github/env-pat';

describe('resolveEnvPat', () => {
  it('prefers REVO_GITHUB_PAT over GITHUB_PAT', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: 'revo-token', GITHUB_PAT: 'shell-token' })).toEqual({
      name: 'REVO_GITHUB_PAT',
      value: 'revo-token',
    });
  });

  it('falls back to GITHUB_PAT when REVO_GITHUB_PAT is not set', () => {
    expect(resolveEnvPat({ GITHUB_PAT: 'cloud-run-token' })).toEqual({
      name: 'GITHUB_PAT',
      value: 'cloud-run-token',
    });
  });

  it('treats an unresolved 1Password reference as unset', () => {
    expect(
      resolveEnvPat({ REVO_GITHUB_PAT: 'op://vault/item/credential', GITHUB_PAT: 'shell-token' })
    ).toEqual({ name: 'GITHUB_PAT', value: 'shell-token' });
    expect(resolveEnvPat({ GITHUB_PAT: ' op://vault/item/credential' })).toBeNull();
  });

  it('treats empty or blank values as unset and trims the value', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: '  ', GITHUB_PAT: '' })).toBeNull();
    expect(resolveEnvPat({ REVO_GITHUB_PAT: ' revo-token\n' })).toEqual({
      name: 'REVO_GITHUB_PAT',
      value: 'revo-token',
    });
  });

  it('returns null when neither name is set (Secret Manager is used)', () => {
    expect(resolveEnvPat({})).toBeNull();
  });
});
