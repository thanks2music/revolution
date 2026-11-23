/**
 * AuthGuard の出し分け。使ってよいと分かるまで children を描かない
 * (描くと Firestore を読みに行き、permission-denied が出る)。データを守るのは rules。
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthGuard } from '@/components/auth/auth-guard';
import type { AuthContextValue, AuthStatus } from '@/lib/auth/auth-context';

const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const signOutMock = jest.fn();
const useAuthMock = jest.fn();
jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => useAuthMock() as AuthContextValue,
}));

function setStatus(status: AuthStatus) {
  useAuthMock.mockReturnValue({
    status,
    user: null,
    uid: null,
    email: 'someone@example.com',
    error: null,
    signIn: jest.fn(),
    signOut: signOutMock,
    clearError: jest.fn(),
  });
}

const PROTECTED_TEXT = 'protected content';

function renderGuard() {
  return render(
    <AuthGuard>
      <p>{PROTECTED_TEXT}</p>
    </AuthGuard>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  signOutMock.mockResolvedValue(undefined);
});

describe('AuthGuard', () => {
  it('hides children while the auth state is still resolving', () => {
    setStatus('loading');
    renderGuard();

    expect(screen.queryByText(PROTECTED_TEXT)).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to login and hides children when unauthenticated', () => {
    setStatus('unauthenticated');
    renderGuard();

    // replace であること (push だと戻るボタンで行き来する)
    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(screen.queryByText(PROTECTED_TEXT)).not.toBeInTheDocument();
  });

  it('tells a user without the claims that they have no permission, with a way to log out', async () => {
    setStatus('forbidden');
    renderGuard();

    expect(screen.queryByText(PROTECTED_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText('権限がありません')).toBeInTheDocument();
    expect(screen.getByText(/someone@example\.com/)).toBeInTheDocument();
    // ログインの画面へ勝手に飛ばさない (飛ばすと、また同じアカウントで入って行き来する)
    expect(replaceMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'ログアウト' }));

    // ログインの画面へ移すのは、ログアウトで状態が unauthenticated になった後の AuthGuard (上のテスト)
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('renders children only once authorized', () => {
    setStatus('authorized');
    renderGuard();

    expect(screen.getByText(PROTECTED_TEXT)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
