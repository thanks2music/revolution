/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  attachAvatar,
  avatarVariantKeys,
  deleteAvatarObjects,
  readOwnAvatar,
  removeAvatar,
  requestAvatarUpload,
  screenAvatar,
  type AvatarContext,
} from '@revolution/reviews/avatar/operations';
import { createFakeAvatarScreener } from '@revolution/reviews/avatar/screener';
import { createFakePhotoStorage, type FakePhotoStorage } from '@revolution/reviews/photos/storage';
import { createTestDataScope, type TestDataScope } from '@/test-support/test-data';

/**
 * プロフィール画像の操作 (one-more-time #171)。本物の Postgres に対して、操作の層を偽の置き場所 (一時ディレクトリ) と
 * 偽の審査器 (左上の色で決まる: 赤 = 落とす、青 = 失敗、それ以外 = 通す) で叩く
 */
describe('プロフィール画像', () => {
  let data: TestDataScope;
  let storage: FakePhotoStorage;
  let ctx: AvatarContext;
  const screener = createFakeAvatarScreener();

  beforeEach(async () => {
    data = createTestDataScope();
    storage = createFakePhotoStorage(await mkdtemp(path.join(os.tmpdir(), 'profile-avatar-it-')));
    ctx = { db: data.admin, storage, prefix: 'preview/' };
  });
  afterEach(async () => {
    await data.cleanup();
    await rm(storage.root, { recursive: true, force: true });
  });

  async function newProfile(): Promise<string> {
    const member = await data.createMember();
    const { data: row, error } = await data.admin
      .from('profiles')
      .select('id')
      .eq('auth_user_id', member.userId)
      .single();
    if (error) throw error;
    return row.id as string;
  }

  function jpeg(color: { r: number; g: number; b: number }, width = 400, height = 300) {
    return sharp({ create: { width, height, channels: 3, background: color } })
      .jpeg()
      .toBuffer();
  }

  /** URL を出し、受け取り場所に置き、取り込む (ブラウザの代わり) */
  async function upload(profileId: string, body: Buffer) {
    const request = await requestAvatarUpload(ctx, {
      profileId,
      file: { contentType: 'image/jpeg', size: body.length },
    });
    if (request.kind !== 'ok') throw new Error(`request failed: ${request.kind}`);
    await storage.writeIntake(`preview/profiles/${profileId}/${request.imageId}`, body);
    return attachAvatar(ctx, { profileId, imageId: request.imageId });
  }

  async function publicKeyOf(profileId: string) {
    const { data: row } = await data.admin
      .from('profiles')
      .select('avatar_public_key')
      .eq('id', profileId)
      .single();
    return row?.avatar_public_key as string | null;
  }

  it('設定すると審査中、通ると公開して配信側に写す', async () => {
    const profileId = await newProfile();
    const attached = await upload(profileId, await jpeg({ r: 20, g: 200, b: 20 }));
    expect(attached).toMatchObject({ kind: 'ok' });
    const key = (attached as { key: string }).key;
    expect(await readOwnAvatar(data.admin, profileId)).toMatchObject({ status: 'pending', key });
    expect(await publicKeyOf(profileId)).toBeNull();

    // 正方形の 3 段 × 2 形式を保管側に置いた
    const stored = await storage.readStored(`${key}/256.webp`);
    expect(stored).not.toBeNull();
    expect(await sharp(stored!).metadata()).toMatchObject({ width: 256, height: 256 });

    expect(await screenAvatar({ ...ctx, screener }, { profileId, key })).toEqual({
      kind: 'published',
    });
    expect(await publicKeyOf(profileId)).toBe(key);
    for (const variantKey of avatarVariantKeys(key)) {
      expect(await storage.readPublic(variantKey)).not.toBeNull();
    }
  });

  it('落ちたら理由を残して物を消す。審査の失敗は「確認できなかった」', async () => {
    const profileId = await newProfile();
    const red = (await upload(profileId, await jpeg({ r: 255, g: 0, b: 0 }))) as { key: string };
    expect(await screenAvatar({ ...ctx, screener }, { profileId, key: red.key })).toEqual({
      kind: 'rejected',
      reasonCode: 'sexual_or_violent',
    });
    expect(await readOwnAvatar(data.admin, profileId)).toEqual({
      status: 'rejected',
      key: null,
      reasonCode: 'sexual_or_violent',
      removed: false,
    });
    expect(await storage.readStored(`${red.key}/256.webp`)).toBeNull();

    // 選び直せる。今度は審査が失敗する (青)
    const blue = (await upload(profileId, await jpeg({ r: 0, g: 0, b: 255 }))) as { key: string };
    expect(await screenAvatar({ ...ctx, screener }, { profileId, key: blue.key })).toEqual({
      kind: 'rejected',
      reasonCode: 'unverifiable',
    });
  });

  it('審査中に外すと審査をやめる (結果を書かない)', async () => {
    const profileId = await newProfile();
    const attached = (await upload(profileId, await jpeg({ r: 20, g: 200, b: 20 }))) as {
      key: string;
    };
    expect(await removeAvatar(ctx, profileId)).toEqual({ kind: 'ok' });
    expect(await screenAvatar({ ...ctx, screener }, { profileId, key: attached.key })).toEqual({
      kind: 'skipped',
    });
    expect(await readOwnAvatar(data.admin, profileId)).toMatchObject({ status: null, key: null });
    expect(await storage.readStored(`${attached.key}/256.webp`)).toBeNull();
  });

  it('替えると前の画像を保管側と配信側から消す。前の画像の審査は書かない', async () => {
    const profileId = await newProfile();
    const first = (await upload(profileId, await jpeg({ r: 20, g: 200, b: 20 }))) as {
      key: string;
    };
    await screenAvatar({ ...ctx, screener }, { profileId, key: first.key });
    const second = (await upload(profileId, await jpeg({ r: 30, g: 30, b: 30 }))) as {
      key: string;
    };
    expect(second.key).not.toBe(first.key);
    expect(await storage.readPublic(`${first.key}/256.webp`)).toBeNull();
    expect(await storage.readStored(`${first.key}/256.webp`)).toBeNull();
    expect(await screenAvatar({ ...ctx, screener }, { profileId, key: first.key })).toEqual({
      kind: 'skipped',
    });
    expect(await readOwnAvatar(data.admin, profileId)).toMatchObject({
      status: 'pending',
      key: second.key,
    });
  });

  it('BOSS が外した会員は、URL も取り込みも断る', async () => {
    const profileId = await newProfile();
    await data.admin
      .from('profiles')
      .update({ avatar_status: 'removed', avatar_removed_at: new Date().toISOString() })
      .eq('id', profileId);
    expect(
      await requestAvatarUpload(ctx, {
        profileId,
        file: { contentType: 'image/jpeg', size: 1000 },
      })
    ).toEqual({ kind: 'removed' });
    expect(await removeAvatar(ctx, profileId)).toEqual({ kind: 'removed' });
  });

  it('サーバーが出していない画像は取り込まない。形式の違う物は断る', async () => {
    const profileId = await newProfile();
    expect(
      await attachAvatar(ctx, { profileId, imageId: '00000000-0000-4000-8000-000000000000' })
    ).toEqual({ kind: 'missing' });

    const request = await requestAvatarUpload(ctx, {
      profileId,
      file: { contentType: 'image/jpeg', size: 10 },
    });
    if (request.kind !== 'ok') throw new Error('request failed');
    await storage.writeIntake(
      `preview/profiles/${profileId}/${request.imageId}`,
      Buffer.from('not an image')
    );
    expect(await attachAvatar(ctx, { profileId, imageId: request.imageId })).toEqual({
      kind: 'rejected',
      reason: 'unsupported',
    });
  });

  it('退会の時に呼ぶ deleteAvatarObjects は、保管側と配信側の物を消す', async () => {
    const profileId = await newProfile();
    const attached = (await upload(profileId, await jpeg({ r: 20, g: 200, b: 20 }))) as {
      key: string;
    };
    await screenAvatar({ ...ctx, screener }, { profileId, key: attached.key });
    await deleteAvatarObjects(storage, attached.key);
    for (const variantKey of avatarVariantKeys(attached.key)) {
      expect(await storage.readStored(variantKey)).toBeNull();
      expect(await storage.readPublic(variantKey)).toBeNull();
    }
  });
});
