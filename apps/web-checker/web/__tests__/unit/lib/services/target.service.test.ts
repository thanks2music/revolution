/**
 * TargetService が書くキー。rules が許すキーと同じでないと保存できない。`checkedAt` を書くと、
 * 見回りがその監視対象を飛ばし続ける。どれも画面を見ても分からないので、呼び出しの引数を直接確かめる。
 */

import { TargetService } from '@/lib/services/target.service';

const addDocMock = jest.fn();
const updateDocMock = jest.fn();
const deleteDocMock = jest.fn();
const setDocMock = jest.fn();
const getDocsMock = jest.fn();

jest.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args) as unknown,
  updateDoc: (...args: unknown[]) => updateDocMock(...args) as unknown,
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args) as unknown,
  setDoc: (...args: unknown[]) => setDocMock(...args) as unknown,
  getDocs: (...args: unknown[]) => getDocsMock(...args) as unknown,
  getDoc: jest.fn(),
  collection: (...args: unknown[]) => ({ __type: 'collection', args }),
  doc: (...args: unknown[]) => ({ __type: 'doc', args }),
  query: (...args: unknown[]) => ({ __type: 'query', args }),
  orderBy: (...args: unknown[]) => ({ __type: 'orderBy', args }),
  startAfter: (...args: unknown[]) => ({ __type: 'startAfter', args }),
  limit: (...args: unknown[]) => ({ __type: 'limit', args }),
}));

jest.mock('@/lib/firebase/client', () => ({
  getFirebaseDb: () => ({ __type: 'db' }),
}));

const input = {
  url: 'https://example.com',
  selector: '#content',
  title: 'サンプル公式サイト',
  cron: '0 * * * *',
};

const payloadOf = (mock: jest.Mock) => mock.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  addDocMock.mockResolvedValue({ id: 'target-1' });
  updateDocMock.mockResolvedValue(undefined);
  deleteDocMock.mockResolvedValue(undefined);
});

describe('TargetService.create', () => {
  it('writes exactly the keys the rules allow on create', async () => {
    await TargetService.create(input, 'uid-1');

    expect(Object.keys(payloadOf(addDocMock)).sort()).toEqual(
      ['createdAt', 'createdBy', 'cron', 'selector', 'title', 'url'].sort()
    );
  });

  it('writes to the web_checker_targets collection', async () => {
    await TargetService.create(input, 'uid-1');

    expect(addDocMock.mock.calls[0][0]).toEqual({
      __type: 'collection',
      args: [{ __type: 'db' }, 'web_checker_targets'],
    });
  });

  it('sets createdBy to the caller uid and createdAt to a plain number', async () => {
    const result = await TargetService.create(input, 'uid-1');
    const payload = payloadOf(addDocMock);

    expect(payload.createdBy).toBe('uid-1');
    // serverTimestamp() (Timestamp) ではなく数値。orderBy('createdAt') から外れないよう必ず書く
    expect(typeof payload.createdAt).toBe('number');
    expect(payload.createdAt).toBeGreaterThan(0);
    expect(result).toEqual({ id: 'target-1', createdAt: payload.createdAt });
  });

  it('never writes checkedAt', async () => {
    await TargetService.create(input, 'uid-1');

    expect(payloadOf(addDocMock)).not.toHaveProperty('checkedAt');
  });
});

describe('TargetService.update', () => {
  it('uses updateDoc and never setDoc (a full overwrite would drop createdAt and createdBy)', async () => {
    await TargetService.update('target-1', input, 'uid-2');

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('writes exactly the keys the rules allow on update', async () => {
    await TargetService.update('target-1', input, 'uid-2');

    expect(Object.keys(payloadOf(updateDocMock)).sort()).toEqual(
      ['cron', 'selector', 'title', 'updatedAt', 'updatedBy', 'url'].sort()
    );
  });

  it('records who changed it and when', async () => {
    const result = await TargetService.update('target-1', input, 'uid-2');
    const payload = payloadOf(updateDocMock);

    expect(payload.updatedBy).toBe('uid-2');
    expect(typeof payload.updatedAt).toBe('number');
    expect(result).toEqual({ updatedAt: payload.updatedAt });
  });
});

describe('TargetService.remove', () => {
  it('deletes the document', async () => {
    await TargetService.remove('target-1');

    expect(deleteDocMock).toHaveBeenCalledWith({
      __type: 'doc',
      args: [{ __type: 'db' }, 'web_checker_targets', 'target-1'],
    });
  });
});

describe('TargetService.listPage', () => {
  const snapshotOf = (count: number) => ({
    docs: Array.from({ length: count }, (_unused, index) => ({
      id: `target-${index}`,
      data: () => ({
        ...input,
        title: `監視対象 ${index}`,
        createdAt: 1_000 - index,
        createdBy: 'uid-1',
      }),
    })),
  });

  it('reports hasMore and trims the extra probe row', async () => {
    // limit(n + 1) で 1 件多く読み、n 件だけ返す
    getDocsMock.mockResolvedValue(snapshotOf(3));

    const page = await TargetService.listPage({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursorCreatedAt).toBe(999);
  });

  it('reports no more pages when the probe row is absent', async () => {
    getDocsMock.mockResolvedValue(snapshotOf(2));

    const page = await TargetService.listPage({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursorCreatedAt).toBeNull();
  });
});
