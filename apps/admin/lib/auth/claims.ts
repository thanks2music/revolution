/** JWT の claims に admin の印 (app_metadata.role = 'admin') があるか。proxy (proxy.ts) の入口の確認に使う */
export function isAdminClaims(claims: Record<string, unknown> | null): boolean {
  const appMetadata = claims?.app_metadata;
  return (
    typeof appMetadata === 'object' &&
    appMetadata !== null &&
    (appMetadata as { role?: unknown }).role === 'admin'
  );
}
