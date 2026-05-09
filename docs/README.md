# Revolution Documentation

Revolution プロジェクトの **公開ドキュメント** ハブ。フラット構造で、活発に編集されているドキュメントを直下に置き、安定/停滞しているものは `archive/` に退避しています。

## アクティブなドキュメント

| ファイル | 内容 |
|---|---|
| [overview.md](./overview.md) | プロジェクト概要・ビジョン・利用者像 |
| [current-stack.md](./current-stack.md) | 現行版の技術スタック (Next.js 16 / MDX / LLM 各 SDK 等) |
| [pipeline.md](./pipeline.md) | AI Writer パイプライン詳細 (18 step + Mermaid + drawio + PNG co-located) |
| [monorepo.md](./monorepo.md) | pnpm workspaces + Turborepo 構成 |
| [build.md](./build.md) | ビルド & 開発コマンド (pnpm / turbo) |
| [nextjs-page-props.md](./nextjs-page-props.md) | Next.js Page Props 型定義パターン |
| [ai-writer-cloud-run.md](./ai-writer-cloud-run.md) | AI Writer の Cloud Run デプロイ (GitHub Actions OIDC) |

## archive/

直近 2 ヶ月で実質的な編集がないドキュメントを `archive/` に退避しています。再活性化が必要になったら root へ戻します。

- [archive/branch-protection.md](./archive/branch-protection.md) — main ブランチ保護ルール (2025-10)
- [archive/claude-code-settings.md](./archive/claude-code-settings.md) — Claude Code 設定ガイド (2025-12)
- [archive/atomic-components.md](./archive/atomic-components.md) — Atomic Design コンポーネント設計 (2025-08)
- [archive/icloud-sync.md](./archive/icloud-sync.md) — docs/ の iCloud 同期 (2025-08)
- [archive/future-flutter.md](./archive/future-flutter.md) — 将来構想: Flutter 拡張案 (2025-08)
- [archive/future-pwa.md](./archive/future-pwa.md) — 将来構想: PWA / Capacitor 拡張案 (2025-08)

## 命名ルール

- **フラット構造**: サブディレクトリは `archive/` (退避) と `research/` (調査スナップショット、gitignored) のみ。アクティブドキュメントはすべて `docs/` 直下
- **ファイル名**: 英語 kebab-case (例: `nextjs-page-props.md`)。日本語ファイル名は禁止
- **見出し / 本文**: 日本語可

## ルートに残す基準 (notes/ と同じ思想)

以下のいずれかに該当するファイル **のみ** ルートに置く:

- `git log --follow` での実質編集日が **直近 2 ヶ月以内** (古くなったら `archive/` に退避)
- 設計ドキュメントとして「現状を説明している」ドキュメント (PR/issue で頻繁に参照される)

それ以外は `archive/` に退避。

## 新規ドキュメントの追加方法

新規ドキュメントは以下の方針で配置先を決めてください:

- **公開リファレンス** (アーキ・開発・運用): `docs/<name>.md` (フラット、kebab-case)
- **調査スナップショット** (公開可、時系列付): `docs/research/<topic>-YYYY-MM-DD.md` (gitignored)
- **古くなった公開ドキュメント** (再活性化時のみ参照): `docs/archive/<name>.md`

機密寄り・iPad 参照のメモは `notes/` (gitignored)、AI セッション必須コンテキストは `llm-context/` (gitignored、CLAUDE.md `@` 参照対象) を使用します。

## 関連ドキュメント (本リポジトリ外)

- **iCloud 同期 notes/** (gitignored): プロジェクト思考・要件・設計判断の私記。iPad MWeb で閲覧
- **llm-context/** (gitignored): CLAUDE.md から `@` 参照される Claude セッション必須コンテキスト
- **GitHub Releases**: 更新履歴 ([github.com/thanks2music/revolution/releases](https://github.com/thanks2music/revolution/releases))
