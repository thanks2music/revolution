/**
 * SSRF ガード付きの画像取得
 *
 * 🔴 **なぜこのモジュールが要るか。**
 * OpenAI (`image_url`) / Claude (`source.type: 'url'`) は画像 URL を各社 API へ渡すだけで、
 * 実際の取得は各社サーバーが行う。**Gemini だけは URL 直渡しができず
 * (公開 HTTPS URL を `fileData.fileUri` に渡すと 429 が恒常的に返る)、
 * ai-writer 自身のプロセスが `fetch()` する。**
 *
 * `imageUrls` は**スクレイピングした外部サイト由来**であり、侵害された/悪意あるソースが
 * `http://169.254.169.254/...` のような内部アドレスを返すと、Cloud Run 上の
 * ai-writer がそこへリクエストを送ってしまう (取得結果は Gemini のプロンプトに載る)。
 * よって Gemini 経路を足す本変更と同時にガードを入れる。
 *
 * ⚠️ **残存リスク: DNS rebinding。** 検証時と接続時で名前解決の結果が変わる TOCTOU は
 * アプリ層では塞ぎきれない。完全に塞ぐならネットワーク層 (egress の許可リスト /
 * VPC の firewall) が必要で、それは別レイヤの対処になる。
 *
 * @module lib/utils/safe-image-fetch
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 取得のタイムアウト (ms) */
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 1 枚あたりのダウンロード上限 (bytes)
 *
 * 上限なしで `arrayBuffer()` すると、巨大なレスポンスを返すサーバーでメモリが枯渇する。
 * Vision に渡す画像は実測で 6KB〜200KB 程度なので 10MB あれば十分に余裕がある。
 */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** リダイレクトの追跡上限。各ホップで同じ検証をかける */
const MAX_REDIRECTS = 3;

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
 * IPv6 アドレスが到達させたくない範囲かを判定する (Layer 1: 純粋関数)
 *
 * loopback / ULA / link-local を弾く。IPv4-mapped (`::ffff:a.b.c.d`) は
 * 埋め込まれた IPv4 を {@link isBlockedIpv4} で判定する。
 */
export function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]; // %eth0 等のゾーン ID を落とす

  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped / IPv4-compatible は埋め込みアドレスで判定する
  const mapped = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  const head = normalized.split(':')[0];
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 ULA
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb'))
    return true; // fe80::/10 link-local

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
async function assertPublicHost(url: URL): Promise<void> {
  if (isBlockedHost(url.hostname)) {
    throw new Error(`Blocked image host (internal address): ${url.hostname}`);
  }

  // IP リテラルなら上のチェックで確定しているので DNS 解決は不要
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) return;

  const addresses = await lookup(url.hostname, { all: true });
  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
    if (blocked) {
      throw new Error(
        `Blocked image host (resolves to internal address): ${url.hostname} → ${address}`
      );
    }
  }
}

export interface SafeImageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeImageFetchResult {
  /** 取得したバイト列 */
  buffer: Buffer;
  /** レスポンスの `Content-Type` (無ければ `null`) */
  contentType: string | null;
  /** リダイレクト後の最終 URL */
  finalUrl: string;
}

/**
 * 画像を SSRF ガード付きで取得する
 *
 * - スキームは http(s) のみ
 * - ホストが内部アドレス (IP リテラル / DNS 解決結果 / 既知の内部名) なら拒否
 * - **リダイレクトは手動で追跡し、各ホップに同じ検証をかける**
 *   (`redirect: 'follow'` だと外部 → 内部への転送を検証できない)
 * - ダウンロードサイズに上限を設ける
 *
 * @throws {Error} 検証に失敗した / HTTP が失敗した / 上限を超えた場合
 */
export async function fetchImageSafely(
  imageUrl: string,
  options: SafeImageFetchOptions = {}
): Promise<SafeImageFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let current = new URL(imageUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`Blocked image URL scheme "${current.protocol}" for "${current.href}"`);
    }
    await assertPublicHost(current);

    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    // 3xx は自前で追跡する (各ホップを検証するため)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect without Location header (HTTP ${response.status}): ${current.href}`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) for "${imageUrl}"`);
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Image fetch failed (HTTP ${response.status}): ${current.href}`);
    }

    // Content-Length があれば読む前に弾く (読んでから気づくとメモリを食った後になる)
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `Image too large (Content-Length ${declared} > ${maxBytes}): ${current.href}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Image too large (${buffer.length} > ${maxBytes}): ${current.href}`);
    }

    return {
      buffer,
      contentType: response.headers.get('content-type'),
      finalUrl: current.href,
    };
  }

  // ループは必ず return / throw で抜けるが、型のために置く
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) for "${imageUrl}"`);
}
