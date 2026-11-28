/**
 * 取り込んだ審査のプロンプトの形を確かめる (scripts/fetch-templates.sh から呼ぶ)。
 *
 * 使い方: tsx scripts/check-review-prompt.ts <templates のディレクトリ>
 * 形が正しければ 0、崩れていれば 1 で終わる。中身 (プロンプトの文面) は表示しない。
 */
import { loadAvatarScreeningPrompt } from '@revolution/reviews/avatar/prompt';
import { loadScreeningPrompt } from '@revolution/reviews/screener/prompt';

const dir = process.argv[2];
if (!dir) {
  console.error('[check-review-prompt] templates のディレクトリを引数で渡してください');
  process.exit(1);
}

// 口コミの審査とプロフィール画像の審査 (one-more-time #171) の 2 つ
Promise.all([loadScreeningPrompt(dir), loadAvatarScreeningPrompt(dir)]).then(
  ([review, avatar]) => {
    console.error(
      `[check-review-prompt] ok (review: version ${review.version}, model ${review.model} / ` +
        `avatar: version ${avatar.version}, model ${avatar.model})`
    );
  },
  (error: unknown) => {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`[check-review-prompt] invalid: ${reason}`);
    process.exit(1);
  }
);
