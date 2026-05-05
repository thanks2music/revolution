# Revolution Project - Root Makefile
# Turbo を介して ai-writer + frontend を統合管理

.PHONY: help dev build clean test stop stop-frontend stop-ai-writer status docs-sync docs-create

help:
	@echo "🚀 Revolution Project - 統合コマンド"
	@echo "===================================="
	@echo "📋 主要コマンド:"
	@echo "  make dev          - ai-writer (7777) + frontend (4444) を並行起動"
	@echo "  make build        - 両アプリをビルド"
	@echo "  make clean        - turbo キャッシュ・ビルド成果物クリーン"
	@echo "  make stop         - 全 dev サーバー停止"
	@echo "  make status       - dev サーバー稼働確認"
	@echo ""
	@echo "🔧 個別起動:"
	@echo "  pnpm dev:frontend   - フロントエンドのみ (4444)"
	@echo "  pnpm dev:ai-writer  - AI Writer のみ (7777)"
	@echo ""
	@echo "⚡ 開発ツール:"
	@echo "  pnpm lint         - コード品質チェック"
	@echo "  pnpm type-check   - TypeScript 型チェック"
	@echo "  pnpm test         - テスト実行"
	@echo ""
	@echo "📚 ドキュメント:"
	@echo "  make docs-sync    - iCloud へドキュメント同期"
	@echo "  make docs-create  - ドキュメント作成 + 同期"

dev:
	@pnpm dev

build:
	@pnpm build

clean:
	@pnpm clean

test:
	@pnpm test

stop: stop-frontend stop-ai-writer
	@echo "🛑 All dev servers stopped"

stop-frontend:
	@echo "⚛️  Stopping frontend on port 4444..."
	@lsof -ti:4444 | xargs kill -9 2>/dev/null || true
	@echo "✅ Frontend stopped"

stop-ai-writer:
	@echo "🤖 Stopping ai-writer on port 7777..."
	@lsof -ti:7777 | xargs kill -9 2>/dev/null || true
	@echo "✅ AI Writer stopped"

status:
	@echo "📊 Revolution Dev Server Status"
	@echo "==============================="
	@printf "⚛️  Frontend  (4444): "
	@lsof -ti:4444 >/dev/null 2>&1 && echo "✅ running" || echo "❌ stopped"
	@printf "🤖 AI Writer (7777): "
	@lsof -ti:7777 >/dev/null 2>&1 && echo "✅ running" || echo "❌ stopped"

docs-sync:
	@echo "📚 Syncing documents to iCloud..."
	@./scripts/sync-docs-to-icloud.sh

docs-create:
	@echo "📝 Document creation helper"
	@echo "Usage: make docs-create TYPE=docs PATH=04-backend/BE-new-feature.md"
	@if [ -z "$(TYPE)" ] || [ -z "$(PATH)" ]; then \
		echo "❌ Required parameters missing!"; \
		echo "Example: make docs-create TYPE=docs PATH=04-backend/BE-new-feature.md"; \
		echo "         make docs-create TYPE=private PATH=04-backend/BE-secret.md"; \
		exit 1; \
	fi
	@./scripts/create-doc-and-sync.sh $(TYPE) $(PATH)
