#!/bin/bash

echo "📦 WPGraphQL プラグインのダウンロード..."

# wp-content/plugins ディレクトリ作成
mkdir -p wp-content/plugins

# WPGraphQL プラグインダウンロード
cd wp-content/plugins
curl -L https://github.com/wp-graphql/wp-graphql/releases/latest/download/wp-graphql.zip -o wp-graphql.zip
unzip wp-graphql.zip
rm wp-graphql.zip

echo "✅ WPGraphQL プラグインの準備完了"
echo "⚠️  WordPress管理画面でプラグインを有効化してください"
