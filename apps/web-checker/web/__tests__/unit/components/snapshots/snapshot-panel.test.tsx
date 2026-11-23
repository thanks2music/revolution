/**
 * 履歴の画面。Slack の通知のリンクから直接開かれるので、指定が壊れていても落ちずに戻り道を示す。
 * content は外のページの生の HTML なので、文字として出す。
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SnapshotPanel } from '@/components/snapshots/snapshot-panel';
import type { Snapshot } from '@/types/snapshot';

const snapshotListPageMock = jest.fn();
const targetGetMock = jest.fn();

jest.mock('@/lib/services/snapshot.service', () => ({
  SnapshotService: {
    listPage: (...args: unknown[]) => snapshotListPageMock(...args) as unknown,
  },
}));

jest.mock('@/lib/services/target.service', () => ({
  TargetService: {
    get: (...args: unknown[]) => targetGetMock(...args) as unknown,
  },
}));

let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

const snapshotAt = (index: number): Snapshot => ({
  id: `snapshot-${index}`,
  content: `<p>更新 ${index}</p>`,
  time: 1_700_000_000_000 - index * 1_000,
});

const emptyPage = { items: [], hasMore: false, nextCursorTime: null };

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams('targetId=target-1');
  targetGetMock.mockResolvedValue(null);
});

describe('SnapshotPanel — parameter handling', () => {
  it('shows a way back when targetId is missing', () => {
    searchParams = new URLSearchParams();

    render(<SnapshotPanel />);

    expect(screen.getByText('監視対象を指定してください')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '一覧に戻る' })).toHaveAttribute('href', '/');
    expect(snapshotListPageMock).not.toHaveBeenCalled();
  });

  it('does not accept the retired scheduleId parameter', () => {
    searchParams = new URLSearchParams('scheduleId=target-1');

    render(<SnapshotPanel />);

    expect(screen.getByText('監視対象を指定してください')).toBeInTheDocument();
    expect(snapshotListPageMock).not.toHaveBeenCalled();
  });

  it('rejects a targetId containing a path separator', () => {
    searchParams = new URLSearchParams('targetId=a/b');

    render(<SnapshotPanel />);

    expect(screen.getByText('監視対象を指定してください')).toBeInTheDocument();
    expect(snapshotListPageMock).not.toHaveBeenCalled();
  });
});

describe('SnapshotPanel — listing', () => {
  it('renders snapshots newest first', async () => {
    snapshotListPageMock.mockResolvedValue({
      items: [snapshotAt(0), snapshotAt(1)],
      hasMore: false,
      nextCursorTime: null,
    });

    render(<SnapshotPanel />);

    expect(await screen.findByText('<p>更新 0</p>')).toBeInTheDocument();
    expect(screen.getByText('<p>更新 1</p>')).toBeInTheDocument();
    expect(snapshotListPageMock).toHaveBeenCalledWith('target-1', {
      limit: 10,
      cursorTime: undefined,
    });
  });

  it('renders the raw html as text, never as markup', async () => {
    snapshotListPageMock.mockResolvedValue({
      items: [{ id: 'snapshot-x', content: '<img src=x onerror=alert(1)>', time: 0 }],
      hasMore: false,
      nextCursorTime: null,
    });

    const { container } = render(<SnapshotPanel />);

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('says so when there is no history yet', async () => {
    snapshotListPageMock.mockResolvedValue(emptyPage);

    render(<SnapshotPanel />);

    expect(await screen.findByText('履歴はまだありません。')).toBeInTheDocument();
  });

  it('surfaces a read failure with a retry', async () => {
    snapshotListPageMock
      .mockRejectedValueOnce({ code: 'unavailable', message: 'boom' })
      .mockResolvedValue(emptyPage);

    render(<SnapshotPanel />);

    expect(await screen.findByText('読み込めませんでした')).toBeInTheDocument();
    expect(screen.queryByText('履歴はまだありません。')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));

    expect(await screen.findByText('履歴はまだありません。')).toBeInTheDocument();
  });

  it('appends the next page and forwards the cursor', async () => {
    snapshotListPageMock
      .mockResolvedValueOnce({ items: [snapshotAt(0)], hasMore: true, nextCursorTime: 555 })
      .mockResolvedValueOnce({ items: [snapshotAt(1)], hasMore: false, nextCursorTime: null });

    render(<SnapshotPanel />);
    await screen.findByText('<p>更新 0</p>');

    await userEvent.click(screen.getByRole('button', { name: 'もっと読む' }));

    await waitFor(() => expect(screen.getByText('<p>更新 1</p>')).toBeInTheDocument());
    expect(screen.getByText('<p>更新 0</p>')).toBeInTheDocument();
    expect(snapshotListPageMock).toHaveBeenLastCalledWith('target-1', {
      limit: 10,
      cursorTime: 555,
    });
  });
});

describe('SnapshotPanel — target header', () => {
  it('shows which target is being viewed', async () => {
    targetGetMock.mockResolvedValue({
      id: 'target-1',
      title: 'サンプル公式サイト',
      url: 'https://example.com/news',
      selector: '#news',
      cron: '0 * * * *',
      checkedAt: null,
      createdAt: 1,
      createdBy: 'uid-1',
      updatedAt: null,
      updatedBy: null,
    });
    snapshotListPageMock.mockResolvedValue(emptyPage);

    render(<SnapshotPanel />);

    expect(await screen.findByText('サンプル公式サイト')).toBeInTheDocument();
    expect(targetGetMock).toHaveBeenCalledWith('target-1');
  });

  it('still lists snapshots when the target itself cannot be read', async () => {
    targetGetMock.mockRejectedValue(new Error('nope'));
    snapshotListPageMock.mockResolvedValue({
      items: [snapshotAt(0)],
      hasMore: false,
      nextCursorTime: null,
    });

    render(<SnapshotPanel />);

    expect(await screen.findByText('<p>更新 0</p>')).toBeInTheDocument();
  });
});
