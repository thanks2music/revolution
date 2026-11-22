import { z } from 'zod';

const IdListSchema = z.array(z.number().int().positive());

/**
 * 公開の Server Action が受け取る ID の一覧を読む。配列か確かめてから先頭の max 件だけを確かめ、
 * 形が違えば空を返す (投げない・確かめる量も上限に抑える)
 */
export function parseIdList(raw: unknown, max: number): number[] {
  const parsed = IdListSchema.safeParse(Array.isArray(raw) ? raw.slice(0, max) : null);
  return parsed.success ? parsed.data : [];
}
