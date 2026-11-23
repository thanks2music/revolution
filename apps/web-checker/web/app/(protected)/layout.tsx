import { AuthGuard } from '@/components/auth/auth-guard';
import { AppHeader } from '@/components/layout/app-header';

/**
 * ログインが要る画面。`(protected)` は Route Group なので URL に出ない
 * (`page.tsx` は `/` = out/index.html、`detail/page.tsx` は `/detail` = out/detail.html)。
 */
export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard>
      <AppHeader />
      {children}
    </AuthGuard>
  );
}
