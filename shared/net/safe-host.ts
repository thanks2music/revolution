/**
 * 内部アドレスへの取得を防ぐ (SSRF ガード) ための、ホストの判定。全アプリで共有する。
 *
 * スクレイピングした外部サイト由来の URL や、人が登録した URL を、サーバー側で取得する前に使う。
 * 侵害された / 悪意あるサイトが `http://169.254.169.254/...` のような内部アドレスを返すと、
 * Cloud Run や Cloud Functions がそこへリクエストを送ってしまうため。
 *
 * ⚠️ **DNS rebinding。** {@link assertPublicHost} だけでは、検証時と接続時で名前解決の結果が変わる
 * TOCTOU を塞げない。接続に使う名前解決の中でも {@link isBlockedIpv4} / {@link isBlockedIpv6} で確かめること
 * (WEB チェッカーの `apps/web-checker/functions/src/fetch-fragment.ts` の `guardedLookup`)。
 * AI ライターの取得はまだ取得前の確認だけで、この残存リスクがある。
 *
 * ⚠️ リダイレクトは取得する側で手動で追い (`redirect: 'manual'`)、各ホップに {@link assertPublicHost} をかけること。
 *
 * 外部の依存を持たない (Node の標準モジュールだけ)。
 *
 * @module @revolution/net/safe-host
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 内部アドレスを指すため取得しない、という失敗。試し直しても変わらないので、呼び出し側は `instanceof` で見分けられる */
export class BlockedHostError extends Error {
  override name = 'BlockedHostError';
}

/**
 * 名前で弾く内部ホスト
 *
 * IP リテラルでなくても内部を指すもの。`metadata.google.internal` は GCP の
 * メタデータサーバーで、Cloud Run から到達しうる。
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

/** 内部を指す TLD / サフィックス */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

/**
 * IPv4 アドレスが到達させたくない範囲かを判定する (Layer 1: 純粋関数)
 *
 * RFC 1918 (private) / loopback / link-local (クラウドのメタデータ) /
 * CGNAT / benchmarking / multicast / reserved を弾く。
 */
export function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // パースできないものは安全側 (弾く) に倒す
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (GCP/AWS metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved

  return false;
}

/**
 * IPv6 アドレスを 8 個の 16bit グループへ分解する (Layer 1: 純粋関数)
 *
 * 🔴 **文字列の前方一致で判定してはいけない。**
 * WHATWG URL の IPv6 シリアライザは、パース時にドット表記の IPv4 埋め込みを受け付けても
 * **出力 (`url.hostname`) は常に 16 進表記へ正規化する**。実測:
 *
 * ```
 * new URL('http://[::ffff:169.254.169.254]/').hostname  // → '[::ffff:a9fe:a9fe]'
 * ```
 *
 * 旧実装はドット表記の正規表現で IPv4-mapped を拾おうとしていたため、
 * **`http://[::ffff:169.254.169.254]/` (GCP メタデータサーバー) がガードをすり抜けた**。
 * テストは関数を直接ドット表記で叩いていたので green のままだった
 * (= テストが守る経路と実際に通る経路がずれていた)。表記ゆれに影響されないよう、
 * 必ずグループへ分解してから数値で判定する。
 *
 * @returns 8 要素の数値配列。パースできなければ `null`
 */
export function parseIpv6Groups(address: string): number[] | null {
  let normalized = address.toLowerCase().split('%')[0]; // %eth0 等のゾーン ID を落とす

  // 末尾のドット表記 IPv4 埋め込みを 16 進 2 グループへ畳む
  const dotted = normalized.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${dotted[1]}${hi}:${lo}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const numbers = groups.map((g) => (g === '' ? 0 : Number.parseInt(g, 16)));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  if (groups.some((g) => g !== '' && !/^[0-9a-f]{1,4}$/.test(g))) return null;

  return numbers;
}

/** 16bit グループ 2 つを IPv4 のドット表記へ戻す */
function groupsToIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * IPv6 アドレスが到達させたくない範囲かを判定する (Layer 1: 純粋関数)
 *
 * loopback / unspecified / ULA / link-local に加え、**IPv4 を埋め込む形式**
 * (IPv4-mapped / IPv4-compatible / NAT64 / 6to4) は埋め込みアドレスを
 * {@link isBlockedIpv4} で判定する。埋め込み経由の迂回を塞ぐため。
 */
export function isBlockedIpv6(address: string): boolean {
  const g = parseIpv6Groups(address);
  // パースできないものは安全側 (弾く) に倒す
  if (!g) return true;

  const firstSixZero = g.slice(0, 6).every((x) => x === 0);

  // :: (unspecified) / ::1 (loopback)
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true;

  // ::ffff:a.b.c.d — IPv4-mapped
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isBlockedIpv4(groupsToIpv4(g[6], g[7]));
  }
  // ::a.b.c.d — IPv4-compatible (deprecated だが受け付ける実装がある)
  if (firstSixZero) return isBlockedIpv4(groupsToIpv4(g[6], g[7]));
  // 64:ff9b::/96 — NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIpv4(groupsToIpv4(g[6], g[7]));
  }
  // 2002::/16 — 6to4 (埋め込み IPv4 は 2〜3 グループ目)
  if (g[0] === 0x2002) return isBlockedIpv4(groupsToIpv4(g[1], g[2]));

  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  return false;
}

/** ホスト名 / IP リテラルが到達させたくない相手かを判定する (Layer 1: 純粋関数) */
export function isBlockedHost(hostname: string): boolean {
  // URL の host は IPv6 だと [::1] のように括られる
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const version = isIP(host);
  if (version === 4) return isBlockedIpv4(host);
  if (version === 6) return isBlockedIpv6(host);

  return false;
}

/**
 * ホスト名を解決し、内部アドレスを指していないことを確認する
 *
 * IP リテラルの直接指定だけでなく、**内部 IP を返す DNS レコード**も塞ぐ。
 * 解決できないホストは取得しても失敗するので、そのまま throw する。
 */
export async function assertPublicHost(url: URL): Promise<void> {
  if (isBlockedHost(url.hostname)) {
    throw new BlockedHostError(`Blocked host (internal address): ${url.hostname}`);
  }

  // IP リテラルなら上のチェックで確定しているので DNS 解決は不要
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) return;

  const addresses = await lookup(url.hostname, { all: true });
  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
    if (blocked) {
      throw new BlockedHostError(
        `Blocked host (resolves to internal address): ${url.hostname} → ${address}`
      );
    }
  }
}
