/**
 * 取り込んだ審査のプロンプトの形を確かめる (scripts/fetch-templates.sh から呼ぶ)。
 *
 * 使い方: tsx scripts/check-review-prompt.ts <templates のディレクトリ>
 * 形が正しければ 0、崩れていれば 1 で終わる。中身 (プロンプトの文面) は表示しない。
 */
import { loadScreeningPrompt } from '@revolution/reviews/screener/prompt';

const dir = process.argv[2];
if (!dir) {
  console.error('[check-review-prompt] templates のディレクトリを引数で渡してください');
  process.exit(1);
}

loadScreeningPrompt(dir).then(
  prompt => {
    console.error(`[check-review-prompt] ok (version ${prompt.version}, model ${prompt.model})`);
  },
  (error: unknown) => {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`[check-review-prompt] invalid: ${reason}`);
    process.exit(1);
  }
);
