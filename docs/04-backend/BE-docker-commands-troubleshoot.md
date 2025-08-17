# Docker コマンド集とトラブルシューティングガイド

## 📋 よく使うDockerコマンド（Revolution Project用）

### 🚀 基本操作

```bash
# コンテナ起動（バックグラウンド）
docker-compose up -d

# コンテナ停止
docker-compose stop

# コンテナ停止かつデータが消えるため注意
docker-compose down

# コンテナ再起動
docker-compose restart

# ログ確認（リアルタイム）
docker-compose logs -f

# 特定サービスのログ確認
docker-compose logs -f wordpress
docker-compose logs -f mysql
```

### 🔨 ビルド関連

```bash
# イメージをビルド（キャッシュ使用）
docker-compose build

# イメージを強制再ビルド（キャッシュ無視）
docker-compose build --no-cache

# 特定サービスのみビルド
docker-compose build wordpress

# ビルド後に起動
docker-compose up -d --build
```

### 🔍 状態確認

```bash
# 実行中のコンテナ確認
docker-compose ps

# コンテナの詳細情報
docker-compose ps -a

# イメージ一覧
docker images

# ボリューム一覧
docker volume ls

# ネットワーク一覧
docker network ls
```

### 🛠️ デバッグ・メンテナンス

```bash
# コンテナに入る（bash）
docker-compose exec wordpress bash
docker-compose exec mysql bash

# コンテナに入る（sh - bashがない場合）
docker-compose exec wordpress sh

# MySQLに接続
docker-compose exec mysql mysql -u root -ppassword

# WordPressのファイル確認
docker-compose exec wordpress ls -la /var/www/html/

# PHPバージョン確認
docker-compose exec wordpress php -v

# Apache設定確認
docker-compose exec wordpress apache2ctl -S
```

### 🧹 クリーンアップ

```bash
# コンテナとネットワークを削除
docker-compose down

# コンテナ、ネットワーク、ボリュームを削除（データも削除）
docker-compose down -v

# 未使用のイメージを削除
docker image prune

# 未使用のボリュームを削除
docker volume prune

# 全ての未使用リソースを削除（危険）
docker system prune -a

# Dockerのディスク使用量確認
docker system df
```

## 🚨 よくあるトラブルと解決方法

### 1. ポート競合エラー
**エラー**: `bind: address already in use`

**原因**: ポート8080が既に使用中

**解決方法**:
```bash
# 使用中のポート確認
lsof -i :8080

# プロセスを終了
kill -9 [PID]

# または docker-compose.yml のポートを変更
ports:
  - "8081:8080"  # 8081に変更
```

### 2. Dockerfile のCOPYエラー
**エラー**: `failed to process: unexpected end of statement`

**原因**: Dockerfileの文法エラー（改行、引用符の問題）

**解決方法**:
```dockerfile
# ❌ 悪い例（複数行で引用符が不整合）
COPY file.sh /tmp/ 2>/dev/null || \
    echo "Error message"

# ✅ 良い例（パターンマッチング使用）
COPY file.s[h] /tmp/
```

### 3. ビルドコンテキストエラー
**エラー**: `COPY failed: file not found`

**原因**: Dockerのビルドコンテキスト外のファイル参照

**解決方法**:
```bash
# ファイルをビルドコンテキスト内にコピー
cp ../../scripts/setup.sh ./setup.sh

# またはdocker-compose.ymlでコンテキスト変更
build:
  context: ../..
  dockerfile: apps/backend/Dockerfile
```

### 4. メモリ不足エラー
**エラー**: `Cannot allocate memory`

**原因**: Docker Desktopのメモリ制限

**解決方法**:
1. Docker Desktop → Settings → Resources
2. Memory を 4GB 以上に設定
3. Docker Desktop を再起動

### 5. ボリュームの権限エラー
**エラー**: `Permission denied`

**原因**: ホストとコンテナのユーザーID不一致

**解決方法**:
```bash
# コンテナ内で権限変更
docker-compose exec wordpress chown -R www-data:www-data /var/www/html

# または Dockerfile で設定
RUN chown -R www-data:www-data /var/www/html
```

### 6. MySQLへの接続エラー
**エラー**: `Can't connect to MySQL server`

**原因**: MySQLコンテナがまだ起動中

**解決方法**:
```bash
# MySQL の起動を待つ
docker-compose up -d mysql
sleep 10  # 10秒待つ
docker-compose up -d wordpress

# または depends_on を使用（docker-compose.yml）
depends_on:
  - mysql
```

### 7. キャッシュによる更新反映されない
**症状**: コード変更が反映されない

**解決方法**:
```bash
# キャッシュ無視で再ビルド
docker-compose build --no-cache
docker-compose up -d

# または特定のステージから再ビルド
docker-compose build --no-cache wordpress
```

### 8. ディスク容量不足
**エラー**: `no space left on device`

**解決方法**:
```bash
# Docker の使用状況確認
docker system df

# 未使用リソースをクリーンアップ
docker system prune -a --volumes

# それでも不足の場合、Docker Desktop のディスク割り当てを増やす
```

### 9. docker-compose.yml の version 警告
**警告**: `the attribute 'version' is obsolete`

**解決方法**:
```yaml
# version: '3.8' を削除（最新のdocker-composeでは不要）
services:
  wordpress:
    # ...
```

### 10. コンテナが起動後すぐ停止
**症状**: `Exited (1)` などのステータス

**デバッグ方法**:
```bash
# ログ確認
docker-compose logs wordpress

# 詳細なエラー確認
docker-compose run --rm wordpress bash
# 手動でコマンド実行してエラー確認
```

## 🎯 Revolution Project 固有のコマンド

### WordPress プラグイン更新後の反映
```bash
# プラグインをコピー後、コンテナ再ビルド
./scripts/setup-wordpress.sh
docker-compose build --no-cache wordpress
docker-compose up -d
```

### ローカル開発環境リセット
```bash
# 完全リセット（データも削除）
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

### 本番デプロイ前の確認
```bash
# ローカルでDockerfile検証
docker build -t revolution-wp-test .
docker run -p 8080:8080 revolution-wp-test

# ヘルスチェック
curl http://localhost:8080/health.php
```

## 💡 Tips

### 1. エイリアス設定（.bashrc/.zshrc）
```bash
alias dc='docker-compose'
alias dcup='docker-compose up -d'
alias dcdown='docker-compose down'
alias dclogs='docker-compose logs -f'
alias dcbuild='docker-compose build --no-cache'
```

### 2. 複数プロジェクトの管理
```bash
# プロジェクト名を指定
docker-compose -p revolution up -d
docker-compose -p revolution down
```

### 3. 環境変数の活用
```bash
# .env ファイルで管理
WP_ENV=development
DB_PASSWORD=secure_password

# docker-compose.yml で参照
environment:
  - WP_ENV=${WP_ENV}
```

## 📚 参考リンク

- [Docker公式ドキュメント](https://docs.docker.com/)
- [Docker Compose リファレンス](https://docs.docker.com/compose/)
- [WordPress Docker Hub](https://hub.docker.com/_/wordpress)
- [Docker Desktop トラブルシューティング](https://docs.docker.com/desktop/troubleshoot/)
