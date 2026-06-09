import { z } from 'zod';
import { createSelectSchema } from 'drizzle-zod';

import { favorites } from './db/favorites';

/**
 * Schema-SDD 真実源: favorites の zod 契約 (Layer1)
 *
 * 軽量ポリモーフィック (target_type + target_key)。Closed Beta は
 * target_type='article' 固定 (DB CHECK と一致させる)。target_key は
 * `event_type/work_slug/slug` の URL path 連結キー (空文字は不正)。
 *
 * drizzle-zod の createSelectSchema でテーブル定義からベーススキーマを派生し、
 * target_type の許可値・target_key の最小長を refine で明示する。
 */

/** Closed Beta で許可する いいね対象種別。将来 'event'/'venue'/'work' を追加。 */
export const FAVORITE_TARGET_TYPES = ['article'] as const;

export const FavoriteTargetTypeSchema = z.enum(FAVORITE_TARGET_TYPES);

export const FavoriteSchema = createSelectSchema(favorites, {
  targetType: FavoriteTargetTypeSchema,
  targetKey: z.string().min(1),
});

export type Favorite = z.infer<typeof FavoriteSchema>;
export type FavoriteTargetType = z.infer<typeof FavoriteTargetTypeSchema>;
