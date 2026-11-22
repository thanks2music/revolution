/**
 * ブラウザからログイン・プロフィールの登録へ送る (島のボタンが使う)。
 *
 * 戻り先には pathname だけでなく query と hash も渡し、ログインの後に閲覧していた状態 (絞り込み・
 * ページ送り・アンカー) へ戻す。値はログインのページの sanitizeNextPath が同じオリジンの内部の
 * パスに正規化する (lib/auth/safe-redirect.ts)。
 */
export function goToLogin() {
  const next = encodeURIComponent(
    window.location.pathname + window.location.search + window.location.hash
  );
  window.location.assign(`/login?next=${next}`);
}

/** プロフィールの登録へ (ログイン済みで onboarding の途中の時)。終わるとマイページへ進む */
export function goToOnboarding() {
  window.location.assign('/onboarding');
}
