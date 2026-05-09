# モノレポ構成

Revolution は **pnpm workspaces + Turborepo** で構成される TypeScript モノレポ。

## ワークスペース構造

```text
revolution/
├── apps/
│   ├── frontend/          (Next.js 16、公開 Web サイト)
│   └── ai-writer/         (AI 記事生成パイプライン、Cloud Run デプロイ対象)
├── shared/
│   ├── schemas/           (Zod スキーマ集約、Schema-SDD の真実源)
│   └── types/             (共通 TypeScript 型)
├── tools/
│   └── docs-index.ts      (ドキュメント TOC ビルド)
├── scripts/
│   ├── sync-docs-to-icloud.sh
│   ├── sync-templates.sh
│   └── ...
├── docs/                  (公開ドキュメント、本ディレクトリ)
├── llm-context/           (CLAUDE.md ロード対象、gitignored)
├── notes/                 (iCloud 同期、gitignored)
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 技術選定理由

| 選定 | 理由 |
|---|---|
| **pnpm workspaces** | npm/yarn より厳格な phantom dependency 排除、disk 使用量削減 |
| **Turborepo** | 並列ビルド + cache、`turbo run build` で workspace 全体を効率実行 |
| **TypeScript 5** | strict mode + project references で型安全性を最大化 |

## 関連リポジトリ

`revolution-templates` (private) — YAML テンプレート集。`pnpm sync:templates` で物理コピー同期 (シンボリックリンクではない)。

## 関連ドキュメント

- ブランチ保護ルール: [`archive/branch-protection.md`](./archive/branch-protection.md) (archive 済、必要に応じて再活性化)
- ビルドコマンド: [`build.md`](./build.md)
- AI Writer のデプロイ: [`ai-writer-cloud-run.md`](./ai-writer-cloud-run.md)
