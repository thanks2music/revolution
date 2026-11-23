/**
 * WEB チェッカーの Cloud Functions (第 2 世代)。
 *
 * - `webCheckerDispatch`: 毎時 5 分に監視対象を走査し、見に行く時刻になったものを Pub/Sub に流す
 * - `webCheckerCrawl`: Pub/Sub から 1 件ずつ受け取り、見に行って比べ、変わっていれば Slack に通知する
 * - `webCheckerOnTargetWrite`: 監視対象の作成と、URL・セレクタの変更の直後に見に行く。削除されたら履歴を消す
 *
 * 置き場所の判断は one-more-time の ADR-0007。Firestore と同じ region に置く。
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { PubSub } from '@google-cloud/pubsub';

import { presentEnvValue } from '@revolution/slack/env';
import { postSlackMessage, type SlackMessage } from '@revolution/slack/post-message';

import { crawlTarget, type CrawlOptions } from './crawl';
import { isDue, isLeftToEditCrawl } from './due';
import { fetchFragment } from './fetch-fragment';
import { createFirestoreStore } from './firestore-store';
import { SNAPSHOTS_SUBCOLLECTION, TARGETS_COLLECTION, type Target } from './targets';

const REGION = 'asia-northeast1';
const CRAWL_TOPIC = 'web-checker-crawl';

const slackBotToken = defineSecret('SLACK_BOT_TOKEN');
/** 通知先のチャンネル ID */
const slackChannelId = defineString('SLACK_WEB_CHECKER_CHANNEL_ID');
/** WEB チェッカーの画面の URL (通知の「履歴を見る」のリンク) */
const siteUrl = defineString('WEB_CHECKER_SITE_URL');

initializeApp();
const db = getFirestore();
const store = createFirestoreStore(db);
const pubsub = new PubSub();

async function notify(message: SlackMessage): Promise<void> {
  const token = presentEnvValue(slackBotToken.value());
  const channel = presentEnvValue(slackChannelId.value());
  if (!token || !channel) {
    console.warn('[web-checker] Slack is not configured; skipped a notification');
    return;
  }
  const result = await postSlackMessage({ token, channel }, message);
  // token と本文はログに出さない。失敗のコードだけ残す
  if (!result.ok) console.error(`[web-checker] Slack notification failed: ${result.code}`);
}

async function crawl(targetId: string, options: CrawlOptions = {}): Promise<void> {
  const outcome = await crawlTarget(
    { store, fetchFragment, notify, siteUrl: siteUrl.value(), now: () => Date.now() },
    targetId,
    options,
  );
  console.log(`[web-checker] crawled ${targetId}: ${outcome}`);
}

// 全関数が同じバンドルを読むので、cheerio などの分も含めて 256MiB を取る (128MiB では起動時に落ちた)
const common = { region: REGION, memory: '256MiB', timeoutSeconds: 300 } as const;

export const webCheckerDispatch = onSchedule(
  { ...common, schedule: '5 * * * *', timeZone: 'Asia/Tokyo' },
  async () => {
    const now = new Date();
    const targets = await db.collection(TARGETS_COLLECTION).select('cron', 'checkedAt', 'createdAt').get();
    const due = targets.docs.filter((doc) => {
      const target = doc.data() as Pick<Target, 'cron' | 'checkedAt' | 'createdAt'>;
      return isDue(target, now) && !isLeftToEditCrawl(target, now);
    });
    await Promise.all(due.map((doc) => pubsub.topic(CRAWL_TOPIC).publishMessage({ json: { targetId: doc.id } })));
    console.log(`[web-checker] dispatched ${due.length} of ${targets.size} targets`);
  },
);

export const webCheckerCrawl = onMessagePublished<{ targetId?: string }>(
  { ...common, topic: CRAWL_TOPIC, secrets: [slackBotToken] },
  async (event) => {
    const targetId = event.data.message.json?.targetId;
    if (typeof targetId !== 'string' || targetId === '') {
      console.error('[web-checker] crawl message without targetId');
      return;
    }
    await crawl(targetId);
  },
);

export const webCheckerOnTargetWrite = onDocumentWritten(
  { ...common, document: `${TARGETS_COLLECTION}/{targetId}`, secrets: [slackBotToken] },
  async (event) => {
    const targetId = event.params.targetId;
    const before = event.data?.before.data() as Target | undefined;
    const after = event.data?.after.data() as Target | undefined;

    if (!after) {
      // 監視対象を消したら、履歴 (サブコレクション) も消す。Firestore は親を消しても子を残すため
      await db.recursiveDelete(db.collection(TARGETS_COLLECTION).doc(targetId).collection(SNAPSHOTS_SUBCOLLECTION));
      return;
    }
    if (!before || before.url !== after.url || before.selector !== after.selector) {
      await crawl(targetId, { afterEdit: true });
    }
  },
);
