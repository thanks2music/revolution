import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  startAfter,
  updateDoc,
} from 'firebase/firestore';

import { getFirebaseDb } from '@/lib/firebase/client';
import { TARGETS_COLLECTION } from '@/lib/firestore/collections';
import { toTarget } from '@/lib/firestore/mappers';
import type { Target, TargetInput } from '@/types/target';

/**
 * 監視対象 (`web_checker_targets`) の読み書き。
 *
 * 守ること (rules が同じ条件で止めるので、外すと保存できない):
 *
 * 1. 書いてよいキーは、作成が `url, selector, title, cron, createdAt, createdBy`、更新が
 *    `url, selector, title, cron, updatedAt, updatedBy` だけ。`checkedAt` は Functions だけが書く
 *    (画面が未来の値を書くと、見回りがその監視対象を飛ばし続ける)
 * 2. 更新は `updateDoc`。`setDoc` (全置換) は `createdAt`・`createdBy` を消す。`updateDoc` は存在しない
 *    ドキュメントへの書き込みも失敗させる
 * 3. 日時は `Date.now()` の数値。`serverTimestamp()` は Timestamp になり、Functions が数値として比べられない
 */

export interface TargetPage {
  items: Target[];
  /** 次のページに渡すカーソル。もう無ければ null */
  nextCursorCreatedAt: number | null;
  hasMore: boolean;
}

export class TargetService {
  /**
   * `createdAt` の新しい順に 1 ページ読む。
   *
   * カーソルは snapshot ではなく `createdAt` の値にする (Firebase の型を画面の state に持ち込まないため)。
   * `limit(n + 1)` で 1 件多く読み、次のページがあるかを決める。
   * `orderBy('createdAt')` は `createdAt` の無いドキュメントを結果から外すので、作成時に必ず書く。
   */
  static async listPage(params: { limit: number; cursorCreatedAt?: number }): Promise<TargetPage> {
    const constraints = [
      orderBy('createdAt', 'desc'),
      ...(params.cursorCreatedAt === undefined ? [] : [startAfter(params.cursorCreatedAt)]),
      limitTo(params.limit + 1),
    ];

    const snapshot = await getDocs(
      query(collection(getFirebaseDb(), TARGETS_COLLECTION), ...constraints)
    );
    const all = snapshot.docs.map(entry => toTarget(entry.id, entry.data()));

    const hasMore = all.length > params.limit;
    const items = hasMore ? all.slice(0, params.limit) : all;

    return {
      items,
      hasMore,
      nextCursorCreatedAt: hasMore ? (items.at(-1)?.createdAt ?? null) : null,
    };
  }

  /** 1 件読む。無ければ null。履歴の画面の見出しに使う */
  static async get(id: string): Promise<Target | null> {
    const snapshot = await getDoc(doc(getFirebaseDb(), TARGETS_COLLECTION, id));
    return snapshot.exists() ? toTarget(snapshot.id, snapshot.data()) : null;
  }

  /**
   * 作る。`createdBy` は自分の uid (rules が `request.auth.uid` と同じかを見る)。
   * 作ると Functions がすぐに 1 回目を見に行き、`checkedAt` を書く。
   */
  static async create(input: TargetInput, uid: string): Promise<{ id: string; createdAt: number }> {
    const createdAt = Date.now();

    const created = await addDoc(collection(getFirebaseDb(), TARGETS_COLLECTION), {
      url: input.url,
      selector: input.selector,
      title: input.title,
      cron: input.cron,
      createdAt,
      createdBy: uid,
    });

    return { id: created.id, createdAt };
  }

  /**
   * 変える。`updatedBy` は自分の uid。権限のある人なら、作った人でなくても変えられる。
   * URL か CSS セレクタを変えると、Functions がすぐに見に行く。
   */
  static async update(id: string, input: TargetInput, uid: string): Promise<{ updatedAt: number }> {
    const updatedAt = Date.now();

    await updateDoc(doc(getFirebaseDb(), TARGETS_COLLECTION, id), {
      url: input.url,
      selector: input.selector,
      title: input.title,
      cron: input.cron,
      updatedAt,
      updatedBy: uid,
    });

    return { updatedAt };
  }

  /** 消す。履歴 (snapshots) は Functions が消す */
  static async remove(id: string): Promise<void> {
    await deleteDoc(doc(getFirebaseDb(), TARGETS_COLLECTION, id));
  }
}
