# Branch Protection Setup Guide

このファイルは、GitHub リポジトリの main ブランチに保護設定を追加するためのガイドです。

## 推奨設定

GitHub リポジトリの Settings → Branches → Add branch protection rule で以下を設定:

### Branch name pattern
```
main
```

### Protect matching branches

#### ✅ 推奨設定 (Dependabot Auto-merge を機能させる)

- [x] **Require a pull request before merging**
  - [x] Require approvals: 0 (個人開発のため)
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [ ] Require review from Code Owners (不要)

- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - [x] Status checks that are required:
    - `Type Check & Lint`
    - `Build Apps`

- [ ] **Require conversation resolution before merging** (任意)

- [ ] **Require signed commits** (任意)

- [ ] **Require linear history** (任意)

- [ ] **Require merge queue** (不要 - 個人開発)

- [x] **Do not allow bypassing the above settings** (推奨)

- [ ] **Restrict who can dismiss pull request reviews** (不要)

- [ ] **Allow force pushes** (❌ 危険 - 無効推奨)

- [ ] **Allow deletions** (❌ 危険 - 無効推奨)

## ブランチ保護の効果

### ✅ 有効にすると:
1. CI が通らない PR はマージできない
2. Dependabot auto-merge が正しく動作する
3. 誤った変更が main に入るのを防ぐ
4. チーム開発への移行が容易

### ⚠️ 注意点:
- 個人開発でも CI を通す必要がある
- 緊急修正時は一時的に無効化が必要な場合がある
- Admin 権限でもルールに従う設定の場合、自分も制限される

## 現在の状態 (2025-01-25)

- ❌ ブランチ保護: 未設定
- ✅ Dependabot alerts: 有効
- ✅ Dependabot security updates: 有効
- ✅ CI workflow: 追加済み (.github/workflows/ci.yml)
- ✅ Auto-merge workflow: 追加済み (.github/workflows/dependabot-auto-merge.yml)

## 設定手順

1. GitHub リポジトリを開く: https://github.com/thanks2music/revolution
2. Settings → Branches
3. "Add branch protection rule" をクリック
4. 上記の推奨設定を入力
5. "Create" をクリック

## 確認方法

```bash
# GitHub CLI で確認
gh api repos/thanks2music/revolution/branches/main/protection
```

設定後、Dependabot PR が自動的に:
- CI が通過するのを待つ
- Patch update なら自動マージ
- Major update ならコメントを追加して手動レビューを促す
