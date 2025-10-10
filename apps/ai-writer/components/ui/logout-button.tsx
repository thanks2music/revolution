'use client';

import { useAuth } from '../../lib/auth/auth-context';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const { logout, user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (!user) return null;

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-gray-600">{user.email}</span>
      <button
        onClick={handleLogout}
        className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
      >
        ログアウト
      </button>
    </div>
  );
}