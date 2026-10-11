import os from 'node:os';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';

import {
  GOOGLE_IDENTITY_TOKEN_URL,
  createAnthropicClient,
  defaultLocalConfigDir,
  fetchGoogleIdentityToken,
  resolveAnthropicAuth,
} from '@/lib/ai/anthropic-client';

/**
 * Anthropic のクライアントの作り方 (2026-10-11 に API キーから移行)。
 *
 * - Cloud Run: Workload Identity Federation (Google の ID トークン → Anthropic のトークン)
 * - ローカル: `ant auth login` のプロファイル (~/.config/anthropic-revolution の revolution)
 */

jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@anthropic-ai/sdk/lib/credentials/oidc-federation', () => ({
  oidcFederationProvider: jest.fn(() => 'federation-provider'),
}));

const MockedAnthropic = Anthropic as unknown as jest.Mock;
const mockedOidcFederationProvider = oidcFederationProvider as unknown as jest.Mock;

const FEDERATION_ENV = {
  K_SERVICE: 'revo-ai-writer',
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('resolveAnthropicAuth', () => {
  it('ローカルでは revolution のプロファイルと専用の設定ディレクトリを使う', () => {
    expect(resolveAnthropicAuth({})).toEqual({
      mode: 'profile',
      profile: 'revolution',
      configDir: path.join(os.homedir(), '.config', 'anthropic-revolution'),
    });
  });

  it('ローカルでも ANTHROPIC_PROFILE / ANTHROPIC_CONFIG_DIR を設定すればそちらを使う', () => {
    expect(resolveAnthropicAuth({ ANTHROPIC_PROFILE: 'other', ANTHROPIC_CONFIG_DIR: '/tmp/cfg' })).toEqual({
      mode: 'profile',
      profile: 'other',
      configDir: '/tmp/cfg',
    });
  });

  it('ローカルでは ANTHROPIC_API_KEY があってもプロファイルを使う (キーは使わない)', () => {
    expect(resolveAnthropicAuth({ ANTHROPIC_API_KEY: 'sk-ant-legacy' }).mode).toBe('profile');
  });

  it('Cloud Run ではフェデレーションの ID を返す', () => {
    expect(resolveAnthropicAuth(FEDERATION_ENV)).toEqual({
      mode: 'federation',
      federationRuleId: 'fdrl_test',
      organizationId: '00000000-0000-0000-0000-000000000000',
      serviceAccountId: 'svac_test',
      workspaceId: 'wrkspc_test',
    });
  });

  it('ワークスペースは任意 (ルールが 1 つのワークスペースに限られるため)', () => {
    const { ANTHROPIC_WORKSPACE_ID: _omit, ...env } = FEDERATION_ENV;
    expect(resolveAnthropicAuth(env)).toMatchObject({ mode: 'federation', workspaceId: undefined });
  });

  it('Cloud Run でフェデレーションの変数が欠けていたら、API キーに戻らず失敗にする', () => {
    expect(() =>
      resolveAnthropicAuth({ K_SERVICE: 'revo-ai-writer', ANTHROPIC_API_KEY: 'sk-ant-legacy', ANTHROPIC_FEDERATION_RULE_ID: '' })
    ).toThrow(
      'missing ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID'
    );
  });
});

describe('fetchGoogleIdentityToken', () => {
  it('audience を固定し、format=full (email の claim を載せる) でメタデータサーバーに頼む', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'header.payload.sig\n' });

    await expect(fetchGoogleIdentityToken(fetchImpl as unknown as typeof fetch)).resolves.toBe('header.payload.sig');

    expect(fetchImpl).toHaveBeenCalledWith(GOOGLE_IDENTITY_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    expect(GOOGLE_IDENTITY_TOKEN_URL).toContain('audience=https%3A%2F%2Fapi.anthropic.com');
    expect(GOOGLE_IDENTITY_TOKEN_URL).toContain('format=full');
  });

  it('メタデータサーバーがエラーを返したら失敗にする', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });

    await expect(fetchGoogleIdentityToken(fetchImpl as unknown as typeof fetch)).rejects.toThrow('HTTP 404');
  });
});

describe('createAnthropicClient', () => {
  it('ローカルではプロファイルを明示し、設定ディレクトリが未設定なら既定値を補う', () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: '' };

    createAnthropicClient(env);

    // profile を明示すると、空の ANTHROPIC_API_KEY より優先される (SDK の仕様)
    expect(MockedAnthropic).toHaveBeenCalledWith({ profile: 'revolution' });
    expect(env.ANTHROPIC_CONFIG_DIR).toBe(defaultLocalConfigDir());
    expect(mockedOidcFederationProvider).not.toHaveBeenCalled();
  });

  it('ローカルで設定ディレクトリが設定済みなら上書きしない', () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_CONFIG_DIR: '/tmp/cfg' };

    createAnthropicClient(env);

    expect(env.ANTHROPIC_CONFIG_DIR).toBe('/tmp/cfg');
  });

  it('Cloud Run ではフェデレーションの資格情報でクライアントを作る (API キーを渡さない)', async () => {
    createAnthropicClient({ ...FEDERATION_ENV });

    expect(mockedOidcFederationProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        federationRuleId: 'fdrl_test',
        organizationId: '00000000-0000-0000-0000-000000000000',
        serviceAccountId: 'svac_test',
        workspaceId: 'wrkspc_test',
        baseURL: 'https://api.anthropic.com',
      })
    );
    expect(MockedAnthropic).toHaveBeenCalledWith({ credentials: 'federation-provider' });
  });

  it('Cloud Run の ID トークンは、交換のたびにメタデータサーバーから取り直す', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'jwt' });
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      createAnthropicClient({ ...FEDERATION_ENV });
      const { identityTokenProvider } = mockedOidcFederationProvider.mock.calls[0][0];

      await identityTokenProvider();
      await identityTokenProvider();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
