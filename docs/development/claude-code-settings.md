# Claude Code 設定とカスタマイズガイド / Settings and Configuration Guide

> **最終更新**: 2025-11-16
> **対象バージョン**: Claude Code Latest

このドキュメントは、Claude Codeの設定ファイル（`.claude/settings.json`）の詳細な使い方と、開発効率を向上させるための様々なカスタマイズ方法をまとめたものです。

---

## 📋 目次 / Table of Contents

### 日本語セクション
1. [設定ファイルの基本](#設定ファイルの基本)
2. [Allow Rules - コマンド事前承認](#allow-rules---コマンド事前承認)
3. [パーミッションシステム](#パーミッションシステム)
4. [カスタムスラッシュコマンド](#カスタムスラッシュコマンド)
5. [CLAUDE.md - プロジェクトメモリ](#claudemd---プロジェクトメモリ)
6. [実践的な設定例](#実践的な設定例)
7. [ベストプラクティス](#ベストプラクティス)

### English Sections
1. [Settings File Basics](#settings-file-basics-english)
2. [Allow Rules - Command Pre-approval](#allow-rules---command-pre-approval-english)
3. [Permission System](#permission-system-english)
4. [Custom Slash Commands](#custom-slash-commands-english)
5. [CLAUDE.md - Project Memory](#claudemd---project-memory-english)
6. [Practical Configuration Examples](#practical-configuration-examples-english)
7. [Best Practices](#best-practices-english)

---

## 設定ファイルの基本

### 設定ファイルの種類と配置場所

Claude Codeは3つのレベルで設定ファイルを管理します：

```text
1. ユーザーレベル（全プロジェクト共通）
   ~/.claude/settings.json

2. プロジェクトレベル（チーム共有）
   {project-root}/.claude/settings.json

3. プロジェクトローカル（個人用、Gitで管理しない）
   {project-root}/.claude/settings.local.json
```

### 設定の優先順位

優先順位は以下の通りです（上から順に優先）：

1. **Enterprise管理ポリシー**（組織管理者が設定、最優先）
2. **コマンドライン引数**
3. **ローカルプロジェクト設定**（`.claude/settings.local.json`）
4. **共有プロジェクト設定**（`.claude/settings.json`）
5. **ユーザー設定**（`~/.claude/settings.json`）

### 基本的な設定構造

```json
{
  "permissions": {
    "mode": "default",
    "allow": [],
    "deny": []
  },
  "env": {},
  "model": "sonnet",
  "hooks": {},
  "enabledPlugins": []
}
```

---

## Allow Rules - コマンド事前承認

### 概要

**Allow Rules**を使うと、特定のBashコマンドやツールの実行を事前に承認でき、毎回の確認プロンプトを省略できます。

### 基本的な書き方

```json
{
  "permissions": {
    "allow": [
      "Bash(gcloud secrets:*)",
      "Bash(npm run build)",
      "Read(/path/to/file.txt)"
    ]
  }
}
```

### パターンマッチングのルール

| パターン | 説明 | 例 |
|---------|------|-----|
| `Bash(command)` | 完全一致 | `Bash(npm install)` |
| `Bash(prefix:*)` | プレフィックスマッチ（末尾のみ） | `Bash(git:*)` |
| `ツール名` | すべてのツール使用を許可 | `Read`, `Write` |
| `ツール名(引数)` | 特定の引数のみ許可 | `Edit(/src/**/*.ts)` |

⚠️ **重要な制限**
- ワイルドカード `:*` は**末尾でのみ**使用可能
- 正規表現やglobパターンは使用不可
- プレフィックスマッチングのみ

### 実用例：Google Cloud SDK

```json
{
  "permissions": {
    "allow": [
      "Bash(gcloud secrets:*)",
      "Bash(gcloud iam:*)",
      "Bash(gcloud run:*)",
      "Bash(gcloud logging:*)",
      "Bash(gcloud sql:*)"
    ]
  }
}
```

### 実用例：Node.js開発

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(pnpm:*)",
      "Bash(yarn:*)",
      "Bash(node:*)"
    ]
  }
}
```

### 実用例：Git操作

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)"
    ]
  }
}
```

### ファイルアクセスの制御

```json
{
  "permissions": {
    "allow": [
      "Read(/src/**)",
      "Edit(/src/**/*.ts)"
    ],
    "deny": [
      "Read(.env)",
      "Read(./secrets/**)",
      "Write(/etc/**)"
    ]
  }
}
```

### WebFetchの制御

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:github.com)",
      "WebFetch(domain:docs.anthropic.com)",
      "WebFetch(domain:npmjs.com)"
    ]
  }
}
```

---

## パーミッションシステム

### パーミッションモード

`mode`フィールドで全体的な動作を制御できます：

```json
{
  "permissions": {
    "mode": "default"  // または "acceptEdits", "plan", "bypassPermissions"
  }
}
```

| モード | 説明 | 使用場面 |
|-------|------|---------|
| `default` | 初回のみ確認 | 通常の開発 |
| `acceptEdits` | ファイル編集を自動承認 | リファクタリング作業 |
| `plan` | 読み取り専用（分析のみ） | コードレビュー、調査 |
| `bypassPermissions` | すべて自動承認 | 信頼できる環境のみ |

### 作業ディレクトリの制限

```json
{
  "permissions": {
    "workingDirectories": [
      "/Users/username/projects/my-app",
      "/Users/username/work"
    ]
  }
}
```

---

## カスタムスラッシュコマンド

### カスタムコマンドの作成

#### プロジェクト共有コマンド

`.claude/commands/deploy.md` を作成：

```markdown
---
description: Deploy to production
allowed-tools:
  - Bash(pnpm build)
  - Bash(vercel --prod)
---

Deploy the application to production:

1. Build the project
2. Run vercel deployment
3. Report the deployment URL
```

使い方：`/deploy` と入力

#### 引数付きコマンド

`.claude/commands/test.md`：

```markdown
---
description: Run tests for specific file
argument-hint: test file path
---

Run tests for $ARGUMENTS
```

使い方：`/test src/utils/helpers.test.ts`

#### 個人用コマンド

`~/.claude/commands/review.md`：

```markdown
---
description: Review code changes
allowed-tools:
  - Bash(git diff:*)
  - Read(/*)
---

Review the following changes and provide feedback:

1. Check for code quality issues
2. Identify potential bugs
3. Suggest improvements
4. Check test coverage
```

#### 名前空間の使用

ディレクトリ構造：

```text
.claude/commands/
├── frontend/
│   ├── build.md
│   └── test.md
└── backend/
    ├── deploy.md
    └── migrate.md
```

使い方：
- `/build` → `(project:frontend)` と表示される
- `/deploy` → `(project:backend)` と表示される

---

## CLAUDE.md - プロジェクトメモリ

### CLAUDE.mdの配置場所

```text
1. プロジェクトメモリ（チーム共有）
   {project-root}/CLAUDE.md
   または
   {project-root}/.claude/CLAUDE.md

2. ユーザーメモリ（個人用）
   ~/.claude/CLAUDE.md
```

### 優先順位

1. Enterprise Policy（最優先）
2. Project Memory（`./CLAUDE.md`）
3. User Memory（`~/.claude/CLAUDE.md`）

### CLAUDE.mdの基本構造

```markdown
# Project Instructions for Claude Code

## Project Overview

This is a monorepo project using Next.js, MDX pipeline, and AI Writer (Cloud Run)...

## Development Commands

### Frontend / AI Writer
- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm test` - Run Jest test suite

### Pipeline / AI Writer
- `pnpm --filter @revolution/ai-writer debug:vision` - Vision API 動作確認
- `pnpm --filter @revolution/ai-writer dry-run` - パイプラインドライラン

## Code Style Guidelines

- Use TypeScript strict mode
- Follow Atomic Design pattern
- Prefer functional components with hooks

## Important Notes

- Always run `pnpm type-check` before committing
- Schema-SDD: shared/schemas が真実源
```

### ファイルインポート機能

`CLAUDE.md` 内で他のファイルをインポート：

```markdown
# Main Project Instructions

@./docs/architecture.md
@./docs/api-guidelines.md
@../shared-guidelines/typescript-rules.md
```

### クイックメモリ追加

コマンド入力時に `#` プレフィックスを使用：

```text
# Remember to always use pnpm instead of npm in this project
```

→ どのCLAUDE.mdファイルに保存するか選択できる

---

## 実践的な設定例

### 例1: フルスタック開発環境

`.claude/settings.local.json`：

```json
{
  "permissions": {
    "mode": "acceptEdits",
    "allow": [
      "Bash(pnpm:*)",
      "Bash(npm:*)",
      "Bash(node:*)",
      "Bash(docker:*)",
      "Bash(docker-compose:*)",
      "Bash(gcloud:*)",
      "Bash(vercel:*)",
      "Bash(git status)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Read(/**)",
      "Edit(/src/**)",
      "Edit(/apps/**)",
      "WebFetch(domain:github.com)",
      "WebFetch(domain:npmjs.com)",
      "WebFetch(domain:docs.anthropic.com)"
    ],
    "deny": [
      "Read(.env)",
      "Read(.env.local)",
      "Read(./secrets/**)",
      "Write(/etc/**)"
    ]
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

### 例2: コードレビュー専用設定

`.claude/settings.json`（plan modeで安全に）：

```json
{
  "permissions": {
    "mode": "plan",
    "allow": [
      "Bash(git:*)",
      "Read(/**)"
    ]
  }
}
```

### 例3: Google Cloud開発環境

```json
{
  "permissions": {
    "allow": [
      "Bash(gcloud secrets:*)",
      "Bash(gcloud iam:*)",
      "Bash(gcloud run:*)",
      "Bash(gcloud sql:*)",
      "Bash(gcloud logging:*)",
      "Bash(gcloud projects:*)",
      "Bash(gcloud auth:*)"
    ]
  },
  "env": {
    "GOOGLE_CLOUD_PROJECT": "my-project-id",
    "GCLOUD_REGION": "asia-northeast1"
  }
}
```

### 例4: モノレポ構成

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm --filter:*)",
      "Bash(turbo:*)",
      "Read(/apps/**)",
      "Read(/packages/**)",
      "Edit(/apps/**)",
      "Edit(/packages/**)"
    ],
    "workingDirectories": [
      "/Users/username/projects/my-monorepo"
    ]
  }
}
```

---

## ベストプラクティス

### 1. 設定ファイルの使い分け

| ファイル | 用途 | Git管理 |
|---------|------|---------|
| `~/.claude/settings.json` | 個人の全プロジェクト共通設定 | ❌ |
| `.claude/settings.json` | チーム共有のプロジェクト設定 | ✅ |
| `.claude/settings.local.json` | 個人のプロジェクト設定 | ❌ |

### 2. セキュリティのベストプラクティス

```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.local)",
      "Read(.env.production)",
      "Read(./secrets/**)",
      "Read(**/credentials.json)",
      "Read(**/*key*.json)",
      "Write(/etc/**)",
      "Write(/usr/**)"
    ]
  }
}
```

### 3. .gitignoreの設定

```gitignore
# Claude Code local settings
.claude/settings.local.json
.claude/*.local.json

# Keep team-shared settings
!.claude/settings.json
!.claude/commands/**
```

### 4. CLAUDE.mdの構成例

```markdown
# {Project Name} - Claude Code Instructions

## 🎯 Project Overview
[Brief description]

## 🏗️ Architecture
[Key architectural decisions]

## 🔧 Development Commands
[Frequently used commands]

## 📝 Code Style
[Coding conventions]

## 🚨 Important Notes
[Critical information]

## 📚 References
[Links to documentation]
```

### 5. 段階的な権限設定

開発初期：

```json
{
  "permissions": {
    "mode": "default"  // 慎重に確認しながら進める
  }
}
```

開発中期（パターンが確立）：

```json
{
  "permissions": {
    "mode": "acceptEdits",
    "allow": [
      "Bash(npm run:*)",
      "Bash(git:*)"
    ]
  }
}
```

信頼できる環境：

```json
{
  "permissions": {
    "mode": "bypassPermissions"  // 完全に信頼できる場合のみ
  }
}
```

---

## その他の便利な設定

### 環境変数の設定

```json
{
  "env": {
    "NODE_ENV": "development",
    "NEXT_PUBLIC_API_URL": "http://localhost:3000",
    "TZ": "Asia/Tokyo"
  }
}
```

### モデルのオーバーライド

```json
{
  "model": "opus"  // プロジェクト全体でOpusを使用
}
```

### フックの設定

```json
{
  "hooks": {
    "PostToolUse": {
      "Edit": ".claude/hooks/format-on-save.sh"
    }
  }
}
```

`.claude/hooks/format-on-save.sh`：

```bash
#!/bin/bash
# ファイル編集後に自動フォーマット
pnpm exec prettier --write "$CLAUDE_TOOL_INPUT_file_path"
```

---

## トラブルシューティング

### Allow Rulesが効かない場合

1. **パターンを確認**：`:*` は末尾のみ
2. **優先順位を確認**：ローカル設定 > プロジェクト設定 > ユーザー設定
3. **JSON構文を確認**：カンマ、クォートの位置
4. **設定の再読み込み**：新しいセッションを開始

### Denyルールが優先される

Denyルールは常にAllowより優先されます：

```json
{
  "permissions": {
    "allow": ["Bash(git:*)"],
    "deny": ["Bash(git push)"]  // git pushは拒否される
  }
}
```

---

## 参考リンク

- [Claude Code 公式ドキュメント](https://code.claude.com/docs/en/)
- [Settings Reference](https://code.claude.com/docs/en/settings.md)
- [IAM Documentation](https://code.claude.com/docs/en/iam.md)
- [Custom Slash Commands](https://code.claude.com/docs/en/slash-commands.md)
- [Memory Management](https://code.claude.com/docs/en/memory.md)

---

# English Version

## Settings File Basics {#settings-file-basics-english}

### Configuration File Types and Locations

Claude Code manages settings at three levels:

```text
1. User Level (Global for all projects)
   ~/.claude/settings.json

2. Project Level (Team-shared)
   {project-root}/.claude/settings.json

3. Project Local (Personal, not in Git)
   {project-root}/.claude/settings.local.json
```

### Settings Precedence

Priority from highest to lowest:

1. **Enterprise Managed Policy** (Set by organization admins, highest priority)
2. **Command-line Arguments**
3. **Local Project Settings** (`.claude/settings.local.json`)
4. **Shared Project Settings** (`.claude/settings.json`)
5. **User Settings** (`~/.claude/settings.json`)

### Basic Settings Structure

```json
{
  "permissions": {
    "mode": "default",
    "allow": [],
    "deny": []
  },
  "env": {},
  "model": "sonnet",
  "hooks": {},
  "enabledPlugins": []
}
```

## Allow Rules - Command Pre-approval {#allow-rules---command-pre-approval-english}

### Overview

**Allow Rules** let you pre-approve specific Bash commands or tool usage, eliminating repeated confirmation prompts.

### Basic Syntax

```json
{
  "permissions": {
    "allow": [
      "Bash(gcloud secrets:*)",
      "Bash(npm run build)",
      "Read(/path/to/file.txt)"
    ]
  }
}
```

### Pattern Matching Rules

| Pattern | Description | Example |
|---------|-------------|---------|
| `Bash(command)` | Exact match | `Bash(npm install)` |
| `Bash(prefix:*)` | Prefix match (trailing only) | `Bash(git:*)` |
| `ToolName` | Allow all tool usage | `Read`, `Write` |
| `ToolName(arg)` | Specific argument only | `Edit(/src/**/*.ts)` |

⚠️ **Important Limitations**
- Wildcard `:*` can **only be used at the end**
- Regular expressions and glob patterns are not supported
- Prefix matching only

### Practical Example: Google Cloud SDK

```json
{
  "permissions": {
    "allow": [
      "Bash(gcloud secrets:*)",
      "Bash(gcloud iam:*)",
      "Bash(gcloud run:*)",
      "Bash(gcloud logging:*)",
      "Bash(gcloud sql:*)"
    ]
  }
}
```

### Practical Example: Node.js Development

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(pnpm:*)",
      "Bash(yarn:*)",
      "Bash(node:*)"
    ]
  }
}
```

## Permission System {#permission-system-english}

### Permission Modes

Control overall behavior with the `mode` field:

```json
{
  "permissions": {
    "mode": "default"  // or "acceptEdits", "plan", "bypassPermissions"
  }
}
```

| Mode | Description | Use Case |
|------|-------------|----------|
| `default` | Prompt on first use | Normal development |
| `acceptEdits` | Auto-approve file edits | Refactoring work |
| `plan` | Read-only (analysis only) | Code review, investigation |
| `bypassPermissions` | Auto-approve everything | Trusted environments only |

## Custom Slash Commands {#custom-slash-commands-english}

### Creating Custom Commands

#### Project-Shared Command

Create `.claude/commands/deploy.md`:

```markdown
---
description: Deploy to production
allowed-tools:
  - Bash(pnpm build)
  - Bash(vercel --prod)
---

Deploy the application to production:

1. Build the project
2. Run vercel deployment
3. Report the deployment URL
```

Usage: Type `/deploy`

#### Command with Arguments

`.claude/commands/test.md`:

```markdown
---
description: Run tests for specific file
argument-hint: test file path
---

Run tests for $ARGUMENTS
```

Usage: `/test src/utils/helpers.test.ts`

## CLAUDE.md - Project Memory {#claudemd---project-memory-english}

### CLAUDE.md Locations

```text
1. Project Memory (Team-shared)
   {project-root}/CLAUDE.md
   or
   {project-root}/.claude/CLAUDE.md

2. User Memory (Personal)
   ~/.claude/CLAUDE.md
```

### File Import Feature

Import other files within `CLAUDE.md`:

```markdown
# Main Project Instructions

@./docs/architecture.md
@./docs/api-guidelines.md
@../shared-guidelines/typescript-rules.md
```

## Practical Configuration Examples {#practical-configuration-examples-english}

### Example 1: Full-Stack Development Environment

`.claude/settings.local.json`:

```json
{
  "permissions": {
    "mode": "acceptEdits",
    "allow": [
      "Bash(pnpm:*)",
      "Bash(docker:*)",
      "Bash(gcloud:*)",
      "Bash(vercel:*)",
      "Bash(git:*)",
      "Read(/**)",
      "Edit(/src/**)"
    ],
    "deny": [
      "Read(.env)",
      "Read(./secrets/**)"
    ]
  }
}
```

### Example 2: Code Review Configuration

```json
{
  "permissions": {
    "mode": "plan",
    "allow": [
      "Bash(git:*)",
      "Read(/**)"
    ]
  }
}
```

## Best Practices {#best-practices-english}

### 1. Settings File Usage

| File | Purpose | Git |
|------|---------|-----|
| `~/.claude/settings.json` | Personal global settings | ❌ |
| `.claude/settings.json` | Team-shared project settings | ✅ |
| `.claude/settings.local.json` | Personal project settings | ❌ |

### 2. Security Best Practices

```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(./secrets/**)",
      "Read(**/credentials.json)",
      "Write(/etc/**)"
    ]
  }
}
```

### 3. .gitignore Configuration

```gitignore
# Claude Code local settings
.claude/settings.local.json

# Keep team-shared settings
!.claude/settings.json
!.claude/commands/**
```

---

## 📚 Related Documentation

- [Official Claude Code Documentation](https://code.claude.com/docs/en/)
- [Settings Reference](https://code.claude.com/docs/en/settings.md)
- [IAM Documentation](https://code.claude.com/docs/en/iam.md)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide.md)
- [Custom Slash Commands](https://code.claude.com/docs/en/slash-commands.md)
