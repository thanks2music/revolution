# Revolution Backend Makefile
# WordPress Docker環境の管理

.PHONY: sync-scripts build up down logs clean

# スクリプト同期
sync-scripts:
	@echo "📄 Syncing scripts from ../../scripts/"
	cp ../../scripts/setup-wordpress.sh ./setup-wordpress.sh
	chmod +x ./setup-wordpress.sh
	@echo "✅ Scripts synced successfully"

# Dockerビルド（スクリプト同期付き）
build: sync-scripts
	@echo "🔨 Building Docker image with latest scripts..."
	docker-compose build --no-cache
	@echo "✅ Build completed"

# 起動
up: build
	@echo "🚀 Starting WordPress environment..."
	docker-compose up -d
	@echo "✅ WordPress available at http://localhost:8080"

# 停止(データは引き継ぐ)
stop:
	@echo "🛑 Stopping WordPress environment..."
	docker-compose stop

# 停止(データも消える) - 使用注意！
down:
	@echo "⚠️  警告: down コマンドはコンテナを削除します。"
	@echo "代わりに 'make stop' の使用を推奨します。"
	@echo "続行しますか？ [y/N]: " && read ans && [ $${ans:-N} = y ]
	@echo "🛑 Stopping WordPress environment..."
	docker-compose down

# ログ表示
logs:
	docker-compose logs -f

# 完全クリーンアップ（危険：全データ削除）
clean:
	@echo "🚨 危険: この操作は全データを削除します！"
	@echo "バックアップは取得済みですか？ [y/N]: " && read ans && [ $${ans:-N} = y ]
	@make backup-all
	@echo "🧹 Cleaning up Docker resources..."
	docker-compose down -v
	docker image prune -f
	@echo "✅ Cleanup completed"

# ========== バックアップ関連 ==========

# バックアップディレクトリ作成
backup-dir:
	@mkdir -p ./backups

# データベースのバックアップ
backup-db: backup-dir
	@echo "💾 Backing up database..."
	@docker-compose exec -T mysql mysqldump -uroot -ppassword wordpress > ./backups/db_backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "✅ Database backup completed: ./backups/db_backup_$$(date +%Y%m%d_%H%M%S).sql"

# メディアファイルのバックアップ
backup-media: backup-dir
	@echo "📸 Backing up media files..."
	@tar -czf ./backups/media_backup_$$(date +%Y%m%d_%H%M%S).tar.gz ./wp-content/uploads 2>/dev/null || true
	@echo "✅ Media backup completed: ./backups/media_backup_$$(date +%Y%m%d_%H%M%S).tar.gz"

# 全データのバックアップ
backup-all: backup-dir
	@echo "📦 Starting full backup..."
	@make backup-db
	@make backup-media
	@echo "✅ Full backup completed in ./backups/"
	@ls -lah ./backups/ | tail -n 5

# 自動バックアップ（タイムスタンプ付き）
auto-backup: backup-all
	@echo "🤖 Auto-backup completed at $$(date)"

# ========== リストア関連 ==========

# 最新のデータベースバックアップをリストア
restore-db-latest:
	@echo "🔄 Restoring latest database backup..."
	@latest_db=$$(ls -t ./backups/db_backup_*.sql 2>/dev/null | head -n1); \
	if [ -z "$$latest_db" ]; then \
		echo "❌ No database backup found"; \
		exit 1; \
	else \
		echo "📂 Restoring from: $$latest_db"; \
		docker-compose exec -T mysql mysql -uroot -ppassword wordpress < $$latest_db; \
		echo "✅ Database restored successfully"; \
	fi

# 最新のメディアファイルをリストア
restore-media-latest:
	@echo "🔄 Restoring latest media backup..."
	@latest_media=$$(ls -t ./backups/media_backup_*.tar.gz 2>/dev/null | head -n1); \
	if [ -z "$$latest_media" ]; then \
		echo "❌ No media backup found"; \
		exit 1; \
	else \
		echo "📂 Restoring from: $$latest_media"; \
		tar -xzf $$latest_media; \
		echo "✅ Media files restored successfully"; \
	fi

# 最新の全バックアップをリストア
restore-latest:
	@echo "📥 Restoring latest backups..."
	@make restore-db-latest
	@make restore-media-latest
	@echo "✅ Full restore completed"

# バックアップリスト表示
list-backups:
	@echo "📋 Available backups:"
	@echo "Database backups:"
	@ls -lah ./backups/db_backup_*.sql 2>/dev/null || echo "  No database backups found"
	@echo ""
	@echo "Media backups:"
	@ls -lah ./backups/media_backup_*.tar.gz 2>/dev/null || echo "  No media backups found"

# ========== 安全な操作 ==========

# 安全なリセット（バックアップ付き）
safe-reset:
	@echo "🔄 Safe reset with automatic backup..."
	@make backup-all
	@echo "⚠️  バックアップが完了しました。リセットを続行しますか？ [y/N]: " && read ans && [ $${ans:-N} = y ]
	docker-compose down -v
	docker-compose up -d
	@echo "✅ Reset completed. Use 'make restore-latest' to restore data."

# 安全な再起動
restart:
	@echo "🔄 Restarting WordPress environment (data preserved)..."
	docker-compose restart
	@echo "✅ Restart completed"

# データ検証
verify-data:
	@echo "🔍 Verifying WordPress data..."
	@docker-compose exec mysql mysql -uroot -ppassword -e "USE wordpress; SELECT COUNT(*) as 'Total Posts' FROM wp_posts WHERE post_type='post';" 2>/dev/null || echo "Database not accessible"
	@echo ""
	@echo "Media files:"
	@find ./wp-content/uploads -type f 2>/dev/null | wc -l | xargs echo "  Total files:"

# ========== WP-CLI関連 ==========

# WP-CLIインストール（WordPressコンテナ内）
# 注: docker-compose exec はサービス名(wordpress)を使用、docker exec はコンテナ名を使用
install-wp-cli:
	@echo "📦 Installing WP-CLI..."
	@docker-compose exec wordpress bash -c "curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp"
	@echo "✅ WP-CLI installed"

# WP-CLIコマンド実行（サービス名を使用）
wp-cli:
	@docker-compose exec wordpress wp --allow-root $(cmd)

# プラグイン一覧
wp-plugins:
	@docker-compose exec wordpress wp --allow-root plugin list 2>/dev/null || echo "WP-CLI not installed. Run 'make install-wp-cli' first."

# ユーザー一覧
wp-users:
	@docker-compose exec wordpress wp --allow-root user list 2>/dev/null || echo "WP-CLI not installed. Run 'make install-wp-cli' first."

# ヘルプ
help:
	@echo "Available commands:"
	@echo ""
	@echo "🚀 Basic Operations:"
	@echo "  make up            - Build and start WordPress environment"
	@echo "  make stop          - Stop WordPress (data preserved)"
	@echo "  make restart       - Restart WordPress (data preserved)"
	@echo "  make logs          - Show container logs"
	@echo ""
	@echo "💾 Backup & Restore:"
	@echo "  make backup-all    - Backup database and media files"
	@echo "  make backup-db     - Backup database only"
	@echo "  make backup-media  - Backup media files only"
	@echo "  make restore-latest - Restore latest backups"
	@echo "  make list-backups  - List available backups"
	@echo ""
	@echo "🛡️ Safe Operations:"
	@echo "  make safe-reset    - Reset with automatic backup"
	@echo "  make verify-data   - Verify WordPress data integrity"
	@echo ""
	@echo "🔧 WP-CLI:"
	@echo "  make install-wp-cli - Install WP-CLI in WordPress container"
	@echo "  make wp-plugins    - List installed plugins"
	@echo "  make wp-users      - List WordPress users"
	@echo "  make wp-cli cmd='...' - Run WP-CLI command"
	@echo ""
	@echo "⚠️  Dangerous Operations:"
	@echo "  make down          - Stop and remove containers (use 'stop' instead)"
	@echo "  make clean         - Delete ALL data (requires confirmation)"
