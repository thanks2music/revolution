/** http(s) の URL か (取得する・リンクとして渡すのは、これだけ) */
export function isHttpUrl(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}
