import { z } from 'zod';

/**
 * 監視対象の入力フォームの検証。
 *
 * データを守るのは Firestore の rules で、ここではない (ログインした人は SDK を直接呼べる)。ここの役目は、
 * rules に弾かれる前に、どの項目がなぜ駄目かを伝えること (rules は permission-denied しか返さない)。
 * そのため上限と https の制限は rules と同じ値にしている。変える時は両方をそろえる。
 */

/** rules の `url.size() < 2048` */
const URL_MAX = 2047;
/** rules の `selector.size() < 512` */
const SELECTOR_MAX = 511;
/** rules の `title.size() < 200` */
const TITLE_MAX = 199;

export const targetFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, '名前を入力してください')
    .max(TITLE_MAX, `名前は ${TITLE_MAX} 文字以内で入力してください`),

  // https だけにするのは rules と同じ。URL を変えると Functions がすぐに見に行くため
  url: z
    .string()
    .trim()
    .min(1, 'URL を入力してください')
    .max(URL_MAX, `URL は ${URL_MAX} 文字以内で入力してください`)
    .refine(value => value.startsWith('https://'), {
      message: 'URL は https:// で始めてください',
    })
    .refine(
      value => {
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'URL の形が正しくありません' }
    ),

  selector: z
    .string()
    .trim()
    .min(1, 'CSS セレクタを入力してください')
    .max(SELECTOR_MAX, `CSS セレクタは ${SELECTOR_MAX} 文字以内で入力してください`),

  // cron として読めるかは cron-parser で非同期に確かめる (lib/target/cron.ts)。ここでは空でないことだけ見る
  cron: z.string().trim().min(1, '頻度を指定してください'),
});

export type TargetFormValues = z.infer<typeof targetFormSchema>;

export type TargetFieldErrors = Partial<Record<keyof TargetFormValues, string>>;

/** zod の結果を項目ごとのエラーに直す。作成と編集の両方で使う */
export function validateTargetForm(
  values: TargetFormValues
): { ok: true; data: TargetFormValues } | { ok: false; errors: TargetFieldErrors } {
  const result = targetFormSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: TargetFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    // 項目ごとに最初のエラーだけ出す
    if (!(field in errors)) errors[field as keyof TargetFormValues] = issue.message;
  }

  return { ok: false, errors };
}
