import { resolveEnvPat } from '@/lib/github/env-pat';

describe('resolveEnvPat', () => {
  it('prefers REVO_GITHUB_PAT over GITHUB_PAT', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: 'revo-token', GITHUB_PAT: 'shell-token' })).toEqual({
      kind: 'pat',
      name: 'REVO_GITHUB_PAT',
      value: 'revo-token',
    });
  });

  it('falls back to GITHUB_PAT when REVO_GITHUB_PAT is not set', () => {
    expect(resolveEnvPat({ GITHUB_PAT: 'cloud-run-token' })).toEqual({
      kind: 'pat',
      name: 'GITHUB_PAT',
      value: 'cloud-run-token',
    });
  });

  it('stops at an unresolved REVO_GITHUB_PAT reference instead of using GITHUB_PAT', () => {
    // GITHUB_PAT へ進むと、シェルの古いトークンで同じ 401 が起きるため
    expect(
      resolveEnvPat({ REVO_GITHUB_PAT: 'op://vault/item/credential', GITHUB_PAT: 'shell-token' })
    ).toEqual({ kind: 'unresolved-ref', name: 'REVO_GITHUB_PAT' });
  });

  it('reports an unresolved GITHUB_PAT reference', () => {
    expect(resolveEnvPat({ GITHUB_PAT: 'op://vault/item/credential' })).toEqual({
      kind: 'unresolved-ref',
      name: 'GITHUB_PAT',
    });
  });

  it('trims before checking, so a reference with leading whitespace is still a reference', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: ' op://vault/item/credential' })).toEqual({
      kind: 'unresolved-ref',
      name: 'REVO_GITHUB_PAT',
    });
  });

  it('treats empty or blank values as unset and trims the value', () => {
    expect(resolveEnvPat({ REVO_GITHUB_PAT: '  ', GITHUB_PAT: '' })).toEqual({ kind: 'none' });
    expect(resolveEnvPat({ REVO_GITHUB_PAT: '', GITHUB_PAT: 'cloud-run-token' })).toEqual({
      kind: 'pat',
      name: 'GITHUB_PAT',
      value: 'cloud-run-token',
    });
    expect(resolveEnvPat({ REVO_GITHUB_PAT: ' revo-token\n' })).toEqual({
      kind: 'pat',
      name: 'REVO_GITHUB_PAT',
      value: 'revo-token',
    });
  });

  it('returns none when neither name is set (Secret Manager is used)', () => {
    expect(resolveEnvPat({})).toEqual({ kind: 'none' });
  });
});
