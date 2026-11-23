/**
 * 履歴の読み方。`web_checker_targets/{id}/snapshots` を `time` の新しい順に、1 件多く読んで次のページを決める。
 */

import { SnapshotService } from '@/lib/services/snapshot.service';

const getDocsMock = jest.fn();
const collectionMock = jest.fn((...args: unknown[]) => ({ __type: 'collection', args }));
const orderByMock = jest.fn((...args: unknown[]) => ({ __type: 'orderBy', args }));
const startAfterMock = jest.fn((...args: unknown[]) => ({ __type: 'startAfter', args }));
const limitMock = jest.fn((...args: unknown[]) => ({ __type: 'limit', args }));

jest.mock('firebase/firestore', () => ({
  getDocs: (...args: unknown[]) => getDocsMock(...args) as unknown,
  collection: (...args: unknown[]) => collectionMock(...args),
  query: (...args: unknown[]) => ({ __type: 'query', args }),
  orderBy: (...args: unknown[]) => orderByMock(...args),
  startAfter: (...args: unknown[]) => startAfterMock(...args),
  limit: (...args: unknown[]) => limitMock(...args),
}));

jest.mock('@/lib/firebase/client', () => ({
  getFirebaseDb: () => ({ __type: 'db' }),
}));

const snapshotOf = (count: number) => ({
  docs: Array.from({ length: count }, (_unused, index) => ({
    id: `snapshot-${index}`,
    data: () => ({ content: `<p>${index}</p>`, time: 5_000 - index }),
  })),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SnapshotService.listPage', () => {
  it('reads the snapshots subcollection newest first', async () => {
    getDocsMock.mockResolvedValue(snapshotOf(1));

    await SnapshotService.listPage('target-1', { limit: 10 });

    expect(collectionMock).toHaveBeenCalledWith(
      { __type: 'db' },
      'web_checker_targets',
      'target-1',
      'snapshots'
    );
    expect(orderByMock).toHaveBeenCalledWith('time', 'desc');
    expect(limitMock).toHaveBeenCalledWith(11);
    expect(startAfterMock).not.toHaveBeenCalled();
  });

  it('starts after the cursor and reports the next one', async () => {
    getDocsMock.mockResolvedValue(snapshotOf(3));

    const page = await SnapshotService.listPage('target-1', { limit: 2, cursorTime: 6_000 });

    expect(startAfterMock).toHaveBeenCalledWith(6_000);
    expect(page.items.map(item => item.id)).toEqual(['snapshot-0', 'snapshot-1']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursorTime).toBe(4_999);
  });
});
