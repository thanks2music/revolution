'use client';

/**
 * 会員導線の認証状態プロバイダ (Crescendolls 会員機能 / Vercel 監査 fix)
 *
 * 背景 (Vercel React/Next.js ベストプラクティス監査 / client-swr-dedup, MEDIUM-HIGH):
 * - これまで `AuthNav` (header / mobile / footer の 3 インスタンス) が各々マウント時に
 *   `getAuthNav()` Server Action を呼んでいた。1 ページ表示で同一の認証状態を **3 回**
 *   Server Action 往復していた。
 * - 本 Provider を Layout (Server Component) が Header / children / Footer の外側で 1 つだけ
 *   マウントし、`getAuthNav()` を **1 回だけ** 呼んで `{ isAuthed }` を Context 提供する。
 *   全 `AuthNav` インスタンスは自前 fetch をやめ Context を購読するため、往復は 3 → 1。
 * - SWR は導入しない (現状未依存)。Context で「複数インスタンスが 1 リクエストを共有」を
 *   実現するため、依存追加は不要 (YAGNI)。
 *
 * SSG/ISR 非破壊の維持 (LikeButton / 旧 AuthNav と同じ思想):
 * - 認証状態は cookie 依存で動的。Server Component (Layout/Header/Footer) で読むと記事ルート
 *   全体が動的化し ISR を壊す。よって認証取得は従来同様 **hydration 後のクライアント fetch**。
 * - 初期値は未ログイン (`isAuthed: false`) にしてレイアウトシフトを回避。SSR HTML にも未ログイン
 *   導線が出るため CLS が起きない。
 * - login verify / onboarding 完了 / signOut はいずれも `window.location.assign` の
 *   フルナビゲーション (= ツリー全体が再マウント) のため、本 Provider も再マウントされ
 *   `getAuthNav()` を再取得する。stale な認証状態は残らない (ログイン後は「マイページ」へ切替)。
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { getAuthNav } from '@/actions/auth';

const AuthNavContext = createContext<{ isAuthed: boolean }>({ isAuthed: false });

/**
 * 認証状態を購読する。Provider 配下の全 AuthNav が同一の値 (1 回の getAuthNav 結果) を共有する。
 */
export function useAuthNav() {
  return useContext(AuthNavContext);
}

export function AuthNavProvider({ children }: { children: ReactNode }) {
  // 解決前は未ログイン導線を初期表示 (/login は登録兼ログインで遷移先として安全)。
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let active = true;
    getAuthNav()
      .then((state) => {
        if (active) setIsAuthed(state.isAuthed);
      })
      .catch(() => {
        // 取得失敗は安全側 (未ログイン導線 = 登録誘導) のまま。記事閲覧は阻害しない。
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthNavContext.Provider value={{ isAuthed }}>{children}</AuthNavContext.Provider>
  );
}

export default AuthNavProvider;
