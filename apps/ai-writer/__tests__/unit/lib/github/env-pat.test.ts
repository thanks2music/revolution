import { resolveEnvPat } from '@/lib/github/env-pat';

describe('resolveEnvPat', () => {
  it('prefers REVO_GITHUB_PAT over GITHUB_PAT', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: 'revo-token', GITHUB_PAT: 'shell-token' })).toEqual({
      pat: { name: 'REVO_GITHUB_PAT', value: 'revo-token' },
      unresolvedRefs: [],
    });
  });

  it('falls back to GITHUB_PAT when REVO_GITHUB_PAT is not set', () => {
    expect(resolveEnvPat({ GITHUB_PAT: 'cloud-run-token' })).toEqual({
      pat: { name: 'GITHUB_PAT', value: 'cloud-run-token' },
      unresolvedRefs: [],
    });
  });

  it('skips an unresolved 1Password reference and reports its name', () => {
    expect(
      resolveEnvPat({ REVO_GITHUB_PAT: 'op://vault/item/credential', GITHUB_PAT: 'shell-token' })
    ).toEqual({
      pat: { name: 'GITHUB_PAT', value: 'shell-token' },
      unresolvedRefs: ['REVO_GITHUB_PAT'],
    });
  });

  it('trims before checking, so a reference with leading whitespace is still a reference', () => {
    expect(resolveEnvPat({ GITHUB_PAT: ' op://vault/item/credential' })).toEqual({
      pat: null,
      unresolvedRefs: ['GITHUB_PAT'],
    });
  });

  it('reports both names in order when both are unresolved references (Secret Manager is used)', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: 'op://a/b/c', GITHUB_PAT: 'op://d/e/f' })).toEqual({
      pat: null,
      unresolvedRefs: ['REVO_GITHUB_PAT', 'GITHUB_PAT'],
    });
  });

  it('treats empty or blank values as unset and trims the value', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: '  ', GITHUB_PAT: '' })).toEqual({
      pat: null,
      unresolvedRefs: [],
    });
    expect(resolveEnvPat({ REVO_GITHUB_PAT: ' revo-token\n' }).pat).toEqual({
      name: 'REVO_GITHUB_PAT',
      value: 'revo-token',
    });
  });

  it('returns no PAT when neither name is set (Secret Manager is used)', () => {
    expect(resolveEnvPat({})).toEqual({ pat: null, unresolvedRefs: [] });
  });
});
