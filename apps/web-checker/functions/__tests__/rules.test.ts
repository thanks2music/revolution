/**
 * Firestore の rules のうち、WEB チェッカーの分のテスト (Emulator が要る。`pnpm test:rules`)。
 * rules の本体は AI ライターと共有している `apps/ai-writer/firestore.rules` (project に rules は 1 つ)。
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from '@jest/globals';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

// 拒否されるたびに SDK が警告を出すので、テストの出力から外す
setLogLevel('error');

const RULES_PATH = new URL('../../../ai-writer/firestore.rules', import.meta.url);
const TARGETS = 'web_checker_targets';

let env: RulesTestEnvironment;

const editor = () => env.authenticatedContext('editor-1', { allowedEditor: true }).firestore();
const admin = () => env.authenticatedContext('admin-1', { admin: true }).firestore();
const stranger = () => env.authenticatedContext('stranger-1').firestore();
const anonymous = () => env.unauthenticatedContext().firestore();

const newTarget = (createdBy: string) => ({
  url: 'https://example.com/news',
  selector: '#news',
  title: 'サンプル公式サイト',
  cron: '0 * * * *',
  createdAt: 1,
  createdBy,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-web-checker-rules',
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, TARGETS, 'target-1'), { ...newTarget('editor-1'), checkedAt: 5 });
    await setDoc(doc(db, TARGETS, 'target-1', 'snapshots', 'snap-1'), { content: '<li>A</li>', time: 5 });
  });
});

describe('監視対象の読み取り', () => {
  it('allowedEditor と admin は読める', async () => {
    await assertSucceeds(getDoc(doc(editor(), TARGETS, 'target-1')));
    await assertSucceeds(getDoc(doc(admin(), TARGETS, 'target-1')));
  });

  it('クレームの無い人と未ログインは読めない', async () => {
    await assertFails(getDoc(doc(stranger(), TARGETS, 'target-1')));
    await assertFails(getDoc(doc(anonymous(), TARGETS, 'target-1')));
  });
});

describe('監視対象の作成', () => {
  it('決まったキーだけで、自分を作成者にすれば作れる', async () => {
    await assertSucceeds(setDoc(doc(editor(), TARGETS, 'new'), newTarget('editor-1')));
  });

  it('作成者を他人にはできない', async () => {
    await assertFails(setDoc(doc(editor(), TARGETS, 'new'), newTarget('someone-else')));
  });

  it('checkedAt など決まっていないキーは書けない (見回りを止められないように)', async () => {
    await assertFails(setDoc(doc(editor(), TARGETS, 'new'), { ...newTarget('editor-1'), checkedAt: 9e15 }));
  });

  it('https 以外の URL は登録できない', async () => {
    await assertFails(
      setDoc(doc(editor(), TARGETS, 'new'), { ...newTarget('editor-1'), url: 'http://169.254.169.254/' }),
    );
  });

  it('長すぎる値は登録できない', async () => {
    await assertFails(
      setDoc(doc(editor(), TARGETS, 'new'), { ...newTarget('editor-1'), title: 'あ'.repeat(200) }),
    );
  });

  it('クレームの無い人は作れない', async () => {
    await assertFails(setDoc(doc(stranger(), TARGETS, 'new'), newTarget('stranger-1')));
  });
});

describe('監視対象の更新', () => {
  it('権限のある人なら、作成者でなくても URL などを直せる', async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), TARGETS, 'target-1'), {
        title: '別の名前',
        updatedAt: 6,
        updatedBy: 'admin-1',
      }),
    );
  });

  it('更新者は自分にする', async () => {
    await assertFails(
      updateDoc(doc(editor(), TARGETS, 'target-1'), { title: 'x', updatedAt: 6, updatedBy: 'someone-else' }),
    );
  });

  it('checkedAt・createdBy・createdAt は変えられない', async () => {
    const ref = doc(editor(), TARGETS, 'target-1');
    await assertFails(updateDoc(ref, { checkedAt: 9e15, updatedAt: 6, updatedBy: 'editor-1' }));
    await assertFails(updateDoc(ref, { createdBy: 'editor-2', updatedAt: 6, updatedBy: 'editor-1' }));
    await assertFails(updateDoc(ref, { createdAt: 2, updatedAt: 6, updatedBy: 'editor-1' }));
  });

  it('URL を https 以外にはできない', async () => {
    await assertFails(
      updateDoc(doc(editor(), TARGETS, 'target-1'), {
        url: 'http://example.com',
        updatedAt: 6,
        updatedBy: 'editor-1',
      }),
    );
  });
});

describe('監視対象の削除', () => {
  it('権限のある人は消せる', async () => {
    await assertSucceeds(deleteDoc(doc(editor(), TARGETS, 'target-1')));
  });

  it('クレームの無い人は消せない', async () => {
    await assertFails(deleteDoc(doc(stranger(), TARGETS, 'target-1')));
  });
});

describe('履歴', () => {
  it('権限のある人は読める', async () => {
    await assertSucceeds(getDoc(doc(editor(), TARGETS, 'target-1', 'snapshots', 'snap-1')));
  });

  it('誰も書けない (書くのは Functions だけ)', async () => {
    await assertFails(setDoc(doc(admin(), TARGETS, 'target-1', 'snapshots', 'x'), { content: '', time: 1 }));
  });

  it('クレームの無い人は読めない', async () => {
    await assertFails(getDoc(doc(stranger(), TARGETS, 'target-1', 'snapshots', 'snap-1')));
  });
});
