/**
 * 一覧の読み込み・ページ・作成・編集・削除。
 *
 * 固定したいこと:
 *   1. 読み込みの失敗を「0 件」として見せない
 *   2. 同時に編集できるのは 1 件だけ
 *   3. 権限のある人なら、作った人でなくても編集・削除できる (所有者の制限は無い)
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TargetList } from '@/components/targets/target-list';
import type { Target } from '@/types/target';

const listPageMock = jest.fn();
const removeMock = jest.fn();
const updateMock = jest.fn();
const createMock = jest.fn();

jest.mock('@/lib/services/target.service', () => ({
  TargetService: {
    listPage: (...args: unknown[]) => listPageMock(...args) as unknown,
    remove: (...args: unknown[]) => removeMock(...args) as unknown,
    update: (...args: unknown[]) => updateMock(...args) as unknown,
    create: (...args: unknown[]) => createMock(...args) as unknown,
  },
}));

const CURRENT_UID = 'uid-me';
jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ uid: CURRENT_UID }),
}));

const targetAt = (index: number, createdBy = CURRENT_UID): Target => ({
  id: `target-${index}`,
  url: `https://example.com/${index}`,
  selector: '#content',
  title: `監視対象 ${index}`,
  cron: '0 * * * *',
  checkedAt: null,
  createdAt: 1_000 - index,
  createdBy,
  updatedAt: null,
  updatedBy: null,
});

const pageOf = (items: Target[], nextCursorCreatedAt: number | null = null) => ({
  items,
  hasMore: nextCursorCreatedAt !== null,
  nextCursorCreatedAt,
});

const list = () => screen.getByRole('list', { name: '監視対象の一覧' });
const rowFor = (title: string) => within(list()).getByText(title).closest('li') as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  removeMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue({ updatedAt: 2_000 });
  createMock.mockResolvedValue({ id: 'target-new', createdAt: 3_000 });
});

describe('TargetList — reading', () => {
  it('renders the fetched targets', async () => {
    listPageMock.mockResolvedValue(pageOf([targetAt(1), targetAt(2)]));

    render(<TargetList />);

    expect(await screen.findByText('監視対象 1')).toBeInTheDocument();
    expect(screen.getByText('監視対象 2')).toBeInTheDocument();
    expect(within(rowFor('監視対象 1')).getByRole('link', { name: '履歴' })).toHaveAttribute(
      'href',
      '/detail?targetId=target-1'
    );
  });

  it('distinguishes an empty collection from a failed read', async () => {
    listPageMock.mockResolvedValue(pageOf([]));

    render(<TargetList />);

    expect(await screen.findByText('監視対象はまだありません。')).toBeInTheDocument();
  });

  it('surfaces a read failure with a retry instead of showing an empty list', async () => {
    listPageMock.mockRejectedValue({ code: 'unavailable', message: 'boom' });

    render(<TargetList />);

    expect(await screen.findByText('読み込めませんでした')).toBeInTheDocument();
    expect(screen.queryByText('監視対象はまだありません。')).not.toBeInTheDocument();
  });

  it('appends the next page rather than replacing the current one', async () => {
    listPageMock
      .mockResolvedValueOnce(pageOf([targetAt(1)], 999))
      .mockResolvedValueOnce(pageOf([targetAt(2)]));

    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(screen.getByRole('button', { name: 'もっと読む' }));

    await waitFor(() => expect(screen.getByText('監視対象 2')).toBeInTheDocument());
    expect(screen.getByText('監視対象 1')).toBeInTheDocument();
    expect(listPageMock).toHaveBeenLastCalledWith({ limit: 20, cursorCreatedAt: 999 });
  });
});

describe('TargetList — anyone with the permission can edit', () => {
  it('offers edit and delete on targets created by someone else', async () => {
    listPageMock.mockResolvedValue(pageOf([targetAt(1, 'someone-else')]));

    render(<TargetList />);
    await screen.findByText('監視対象 1');

    const row = rowFor('監視対象 1');
    expect(within(row).getByRole('button', { name: '編集' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: '削除' })).toBeEnabled();
  });
});

describe('TargetList — create', () => {
  it('adds the created target to the top without reloading', async () => {
    listPageMock.mockResolvedValue(pageOf([targetAt(1)]));

    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(screen.getByRole('button', { name: '監視対象を足す' }));
    await userEvent.type(screen.getByLabelText('名前'), 'サンプル公式サイト');
    await userEvent.clear(screen.getByLabelText('URL'));
    await userEvent.type(screen.getByLabelText('URL'), 'https://example.com/news');
    await userEvent.type(screen.getByLabelText('CSS セレクタ'), '#news');
    await userEvent.click(screen.getByRole('button', { name: '足す' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        {
          title: 'サンプル公式サイト',
          url: 'https://example.com/news',
          selector: '#news',
          cron: '0 * * * *',
        },
        CURRENT_UID
      )
    );
    await waitFor(() =>
      expect(within(list()).getAllByRole('heading')[0]).toHaveTextContent('サンプル公式サイト')
    );
    expect(listPageMock).toHaveBeenCalledTimes(1);
  });

  it('shows what is wrong per field and does not save', async () => {
    listPageMock.mockResolvedValue(pageOf([]));

    render(<TargetList />);
    await screen.findByText('監視対象はまだありません。');

    await userEvent.click(screen.getByRole('button', { name: '監視対象を足す' }));
    await userEvent.click(screen.getByRole('button', { name: '足す' }));

    expect(await screen.findByText('名前を入力してください')).toBeInTheDocument();
    expect(screen.getByText('CSS セレクタを入力してください')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('TargetList — exclusive editing', () => {
  beforeEach(() => {
    listPageMock.mockResolvedValue(pageOf([targetAt(1), targetAt(2)]));
  });

  it('disables the other rows and hides the create form while one is being edited', async () => {
    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '編集' }));

    expect(await screen.findByText('監視対象を編集')).toBeInTheDocument();
    const otherRow = rowFor('監視対象 2');
    expect(within(otherRow).getByRole('button', { name: '編集' })).toBeDisabled();
    expect(within(otherRow).getByRole('button', { name: '削除' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '監視対象を足す' })).not.toBeInTheDocument();
  });

  it('discards the draft on cancel without writing anything', async () => {
    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '編集' }));
    const titleInput = await screen.findByLabelText('名前');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, '書き換えた');

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => expect(screen.getByText('監視対象 1')).toBeInTheDocument());
    expect(screen.queryByText('書き換えた')).not.toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('saves the edit and warns that changing the URL triggers a check', async () => {
    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '編集' }));
    const urlInput = await screen.findByLabelText('URL');
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://example.com/changed');

    expect(screen.getByText(/保存するとすぐに見に行きます/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        'target-1',
        {
          title: '監視対象 1',
          url: 'https://example.com/changed',
          selector: '#content',
          cron: '0 * * * *',
        },
        CURRENT_UID
      )
    );
    expect(await screen.findByText('https://example.com/changed')).toBeInTheDocument();
  });
});

describe('TargetList — delete', () => {
  beforeEach(() => {
    listPageMock.mockResolvedValue(pageOf([targetAt(1)]));
  });

  it('asks for confirmation before deleting', async () => {
    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '削除' }));

    expect(await screen.findByText('監視対象を削除しますか？')).toBeInTheDocument();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('removes the row locally after a confirmed delete', async () => {
    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '削除' }));
    await userEvent.click(await screen.findByRole('button', { name: '削除する' }));

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: '監視対象の一覧' })).not.toBeInTheDocument()
    );
    expect(removeMock).toHaveBeenCalledWith('target-1');
    // 読み直していないこと
    expect(listPageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the row and reports the failure when the delete is rejected', async () => {
    removeMock.mockRejectedValue({ code: 'permission-denied', message: 'nope' });

    render(<TargetList />);
    await screen.findByText('監視対象 1');

    await userEvent.click(within(rowFor('監視対象 1')).getByRole('button', { name: '削除' }));
    await userEvent.click(await screen.findByRole('button', { name: '削除する' }));

    expect(await screen.findByText('削除できませんでした')).toBeInTheDocument();
    expect(list()).toHaveTextContent('監視対象 1');
  });
});
