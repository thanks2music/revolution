/**
 * HTML Sanitization Utility
 * XSS攻撃を防ぐためのHTMLサニタイズ処理
 */

import sanitizeHtmlLib from 'sanitize-html';

/**
 * HTMLコンテンツをサニタイズ
 * WordPress由来のHTMLコンテンツを安全にレンダリングするための処理
 *
 * @param dirty - サニタイズ前のHTML文字列
 * @returns サニタイズ後の安全なHTML文字列
 */
export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLib(dirty, {
    // 許可するHTMLタグ（WordPressでよく使われるタグ）
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span',
      'figure', 'figcaption', 'cite', 'del', 'ins', 'sup', 'sub',
    ],
    // 許可する属性
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'img': ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      '*': ['class', 'id', 'style'],
    },
    // URLスキームの制限
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // 自己終了タグを許可
    selfClosing: ['img', 'br', 'hr'],
  });
}

/**
 * プレーンテキストに変換（メタデータ用）
 * HTMLタグをすべて除去してテキストのみを抽出
 *
 * @param html - HTML文字列
 * @returns プレーンテキスト
 */
export function stripHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [],
    allowedAttributes: {},
  });
}
