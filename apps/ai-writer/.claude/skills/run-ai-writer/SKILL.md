---
name: run-ai-writer
description: ai-writer の記事パイプラインをローカルで実行し (pnpm debug:mdx)、結果と Slack 通知を観測する手順。apps/ai-writer の変更を /run や /verify で実際に動かして確かめる時に使う
---

# ai-writer をローカルで動かす

入口は CLI の `pnpm debug:mdx` (`scripts/debug-mdx-url.ts`)。1 回の実行で記事 1 本を処理し、終わりに Slack へ 1 通だけ通知する。コマンドはすべて `apps/ai-writer` で実行する。

## 前提

- `apps/ai-writer/.env.local` が必要 (AI のキーなど)。worktree は `scripts/setup-worktree.sh` で作れば symlink される。`git worktree add` だけで作った worktree には無いので、AI の手前で止まる (`AI_PROVIDER="undefined"` / `API key is required`)
- Slack 通知を送るには `apps/ai-writer/.env.op.local` (1Password の参照) と `op` CLI が必要。無ければ警告を 1 行出して通知なしで動く
- `.env.local` の中身は読まない・表示しない (値の確認はキーの有無だけ)

## 実行

| コマンド | 用途 |
|---|---|
| `pnpm debug:mdx --dry-run <URL>` | `op run` 経由で実行し、Slack に通知する。1Password が Touch ID を求めることがある |
| `pnpm debug:mdx:raw --dry-run <URL>` | `op run` を通さない。通知はしない (1Password がロック中・非対話の時) |
| `pnpm debug:mdx --dry-run --log <URL>` | `logs/` に実行ログと AI 呼び出しの JSONL を残す |

**`--dry-run` を外さない**。外すと本物の記事 PR が作られ、Firestore と R2 にも書き込む。

## 動かす価値のある流れ

| 結果 | 入力 | 終了コード | AI の呼び出し |
|---|---|---|---|
| 失敗 | `http://127.0.0.1:9/x` (つながらない URL) | 1 | なし |
| スキップ | `https://example.com/` (公式 URL が無い) | 0 | 記事選別の 1 回 |
| 成功 | 最近のコラボカフェ記事 (下記) | 0 | 全ステップ (Gemini で 1 分弱) |
| 使い方の表示 | URL なし | 1 | なし (通知もしない) |

成功ケースの URL は、`https://animeanime.jp/rss/index.rdf` から最近の「コラボカフェ」の記事を選ぶ。古い記事は公式サイトが閉じていて (401 など)、詳細抽出でスキップになる。

## 注意点

- **AI の呼び出し失敗はスキップとして返る** (記事選別の catch が安全側に倒すため)。残高切れ (429) でも「⏭️ スキップ」になるので、理由の文を必ず読む。その AI が使えない時は、実行ごとに `AI_PROVIDER=google` などで切り替えられる (dotenv は既にある環境変数を上書きしない)
- **tsx では `@sentry/nextjs` の `captureException` が `undefined` になる**。service の catch で TypeError が起き、本当のエラーが `Sentry.captureException is not a function` に置き換わる (main からある既知の問題)
- 実行すると `debug-logs/` に HTML のダンプが残る。`--log` を付けると `logs/` にも残る。どちらも gitignore 済みだが、確認が終わったら消す

## Slack 通知を観測する

bot は履歴を読む権限を持たないため、Slack 側の応答は HTTP の境界で見る。アプリのコードは変えずに、`fetch` を包むファイルを `NODE_OPTIONS` で先に読み込む。token は出さない。

```bash
cat > /tmp/slack-spy.cjs <<'EOF'
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const res = await original(input, init);
  if (url.startsWith('https://slack.com/api/')) {
    let sent = {};
    try { sent = JSON.parse(init.body); } catch {}
    const body = await res.clone().json().catch(() => null);
    process.stderr.write(`[spy] HTTP ${res.status} ok=${body?.ok} error=${body?.error ?? '-'} ts=${body?.ts ?? '-'}\n`);
    process.stderr.write(`[spy] text=${JSON.stringify(sent.text)}\n[spy] blocks=${JSON.stringify(sent.blocks)}\n`);
  }
  return res;
};
EOF
NODE_OPTIONS="--require /tmp/slack-spy.cjs" pnpm debug:mdx --dry-run <URL>
```

- `ok=true` と `ts` が出れば、Slack が受け付けている。`:raw` では `[spy]` の行が 1 行も出ないことが期待どおり
- 通知の組み立て (`lib/slack/messages.ts`) は、エスケープ・切り詰め・メンションの有無をこの `blocks` で確かめられる
