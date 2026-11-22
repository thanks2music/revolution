/**
 * 偽物 (審査器・写真の置き場所) を使ってよいか。手元の開発とテスト (`NODE_ENV` が development か test)
 * だけに限る。Vercel の Preview も含めて、ビルドした物 (`NODE_ENV=production`) では使わない。
 * 設定の取り違えで、審査なしに公開される・写真が本物の置き場所に行かない、を防ぐ
 */
export function allowsFakeBackends(env: Record<string, string | undefined>): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}
