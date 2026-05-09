# Revolution Documentation

Revolution プロジェクトの **公開ドキュメント** ハブ。3 カテゴリに整理しています。

## カテゴリ

### 📐 [architecture/](./architecture/) — アーキ・構造設計・将来構想

| ファイル | 内容 |
|---|---|
| [overview.md](./architecture/overview.md) | プロジェクト概要・ビジョン・利用者像 |
| [current-stack.md](./architecture/current-stack.md) | 現行版の技術スタック (Next.js 16 / MDX / LLM 各 SDK 等) |
| [pipeline.md](./architecture/pipeline.md) | AI Writer パイプライン詳細 (18 step + Mermaid + drawio) |
| [monorepo.md](./architecture/monorepo.md) | pnpm workspaces + Turborepo 構成 |
| [future-flutter.md](./architecture/future-flutter.md) | 将来構想: Flutter 拡張案 |
| [future-pwa.md](./architecture/future-pwa.md) | 将来構想: PWA / Capacitor 拡張案 |

### 🛠️ [development/](./development/) — 開発ガイド・規約・コンポーネント

| ファイル | 内容 |
|---|---|
| [build.md](./development/build.md) | ビルド & 開発コマンド (pnpm / turbo) |
| [branch-protection.md](./development/branch-protection.md) | main ブランチ保護ルール |
| [nextjs-page-props.md](./development/nextjs-page-props.md) | Next.js Page Props 型定義パターン |
| [atomic-components.md](./development/atomic-components.md) | Atomic Design コンポーネント設計 |
| [claude-code-settings.md](./development/claude-code-settings.md) | Claude Code 設定ガイド |

### 🚀 [operations/](./operations/) — 運用・デプロイ・同期

| ファイル | 内容 |
|---|---|
| [ai-writer-cloud-run.md](./operations/ai-writer-cloud-run.md) | AI Writer の Cloud Run デプロイ (GitHub Actions OIDC) |
| [icloud-sync.md](./operations/icloud-sync.md) | docs/ の iCloud 同期 (iPad 閲覧用) |

## 命名ルール

- **カテゴリ**: `architecture/` / `development/` / `operations/` の 3 つのみ。番号プレフィックス禁止
- **ファイル名**: 英語 kebab-case (例: `nextjs-page-props.md`)。日本語ファイル名は禁止
- **見出し**: 日本語 OK (内部の本文は日本語ベースで記述可能)

## 新規ドキュメントの追加方法

`/revolution docs` サブスキルを使用すると、保存先 (architecture / development / operations) と命名を会話形式で決定できます。詳細は `.claude/skills/revolution/references/docs/workflow.md`。

## 関連ドキュメント (本リポジトリ外)

- **iCloud 同期 notes/** (gitignored): プロジェクト思考・要件・設計判断の私記。iPad MWeb で閲覧
- **llm-context/** (gitignored): CLAUDE.md から `@` 参照される Claude セッション必須コンテキスト
- **GitHub Releases**: 更新履歴 ([github.com/thanks2music/revolution/releases](https://github.com/thanks2music/revolution/releases))
