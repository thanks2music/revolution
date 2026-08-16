/**
 * Layer 1 tests for the SSRF guard used by the Gemini Vision path.
 *
 * ⚠️ **なぜ Gemini だけこのガードが要るか。**
 * OpenAI (`image_url`) / Claude (`source.type: 'url'`) は画像 URL を各社 API へ渡すだけで、
 * 実際の取得は各社サーバーが行う。**Gemini は URL 直渡しができず ai-writer 自身が
 * `fetch()` する**ため、スクレイピング由来の URL がそのまま自サーバーからのリクエストになる。
 *
 * 内部アドレスへ到達させないことをここで固定する。
 */

import {
  isBlockedHost,
  isBlockedIpv4,
  isBlockedIpv6,
} from '@/lib/utils/safe-image-fetch';

describe('isBlockedIpv4', () => {
  it.each([
    ['169.254.169.254', 'クラウドのメタデータサーバー (link-local)'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918 private'],
    ['172.16.0.1', 'RFC1918 private (下端)'],
    ['172.31.255.255', 'RFC1918 private (上端)'],
    ['192.168.1.1', 'RFC1918 private'],
    ['0.0.0.0', 'this network'],
    ['100.64.0.1', 'CGNAT'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
  ])('%s を弾く (%s)', (ip) => {
    expect(isBlockedIpv4(ip)).toBe(true);
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['172.15.0.1'], ['172.32.0.1'], ['192.167.1.1']])(
    '%s は通す (公開アドレス)',
    (ip) => {
      expect(isBlockedIpv4(ip)).toBe(false);
    }
  );

  it('パースできない値は安全側に倒して弾く', () => {
    expect(isBlockedIpv4('999.1.1.1')).toBe(true);
    expect(isBlockedIpv4('1.2.3')).toBe(true);
    expect(isBlockedIpv4('not-an-ip')).toBe(true);
  });
});

describe('isBlockedIpv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'ULA'],
    ['fd12:3456::1', 'ULA'],
    ['fe80::1', 'link-local'],
    ['::ffff:169.254.169.254', 'IPv4-mapped のメタデータサーバー'],
    ['::ffff:127.0.0.1', 'IPv4-mapped の loopback'],
  ])('%s を弾く (%s)', (ip) => {
    expect(isBlockedIpv6(ip)).toBe(true);
  });

  it.each([['2001:4860:4860::8888'], ['::ffff:8.8.8.8']])('%s は通す', (ip) => {
    expect(isBlockedIpv6(ip)).toBe(false);
  });

  it('ゾーン ID 付きの link-local も弾く', () => {
    expect(isBlockedIpv6('fe80::1%eth0')).toBe(true);
  });
});

describe('isBlockedHost', () => {
  it.each([
    ['localhost'],
    ['metadata.google.internal'],
    ['metadata'],
    ['foo.internal'],
    ['printer.local'],
    ['app.localhost'],
  ])('内部を指すホスト名 %s を弾く', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it('IP リテラルも判定する', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('[::1]')).toBe(true); // URL.hostname は IPv6 を括る
    expect(isBlockedHost('93.184.216.34')).toBe(false);
  });

  it('大文字小文字を問わない', () => {
    expect(isBlockedHost('LOCALHOST')).toBe(true);
    expect(isBlockedHost('Metadata.Google.Internal')).toBe(true);
  });

  it('通常の公開ホストは通す', () => {
    expect(isBlockedHost('conan-cafe.jp')).toBe(false);
    expect(isBlockedHost('images.anime-events.com')).toBe(false);
  });
});
