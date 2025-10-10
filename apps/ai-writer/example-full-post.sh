#!/bin/bash

# 全フィールドを指定したWordPress投稿作成の具体例
#
# 使用方法:
# 1. .env ファイルに WORDPRESS_AUTH_TOKEN を設定
# 2. カテゴリー・タグのIDを取得（既に取得済み）
# 3. 著者IDを取得（必要な場合）
# 4. このスクリプトを実行

# 環境変数から認証トークンを読み込み
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

if [ -z "$WORDPRESS_AUTH_TOKEN" ]; then
  echo "Error: WORDPRESS_AUTH_TOKEN is not set"
  echo "Please set it in .env file or export it as an environment variable"
  exit 1
fi

# カテゴリーID: NBA (dGVybTox), News (dGVybTo2)
# タグID: (なし、手動で作成が必要)

curl -X POST http://localhost:7777/test/wordpress/create-post \
  -H "Content-Type: application/json" \
  -d "{
    \"authToken\": \"$WORDPRESS_AUTH_TOKEN\",
    \"title\": \"完全な投稿例：全フィールド指定\",
    \"content\": \"<h2>全フィールドを指定した投稿</h2><p>この投稿は、WPGraphQL CreatePost Mutation で指定可能な全フィールドを使用しています。</p><ul><li>カスタムスラッグ</li><li>カテゴリー指定</li><li>タグ指定</li><li>公開ステータス</li><li>著者指定</li><li>抜粋文</li></ul>\",
    \"slug\": \"complete-post-all-fields-example\",
    \"excerpt\": \"WPGraphQL CreatePost Mutationで指定可能な全フィールドを使用した投稿例\",
    \"status\": \"DRAFT\",
    \"categoryIds\": [\"dGVybTox\", \"dGVybTo2\"],
    \"commentStatus\": \"open\",
    \"pingStatus\": \"closed\"
  }"

echo ""
echo "---"
echo ""
echo "注意事項："
echo "1. categoryIds: カテゴリーのグローバルID（例: dGVybTox）を配列で指定"
echo "2. tagIds: タグのグローバルID（まだタグがない場合は別途作成が必要）"
echo "3. authorId: 指定しない場合は認証ユーザーが著者になる"
echo "4. slug: 指定しない場合はタイトルから自動生成される"
echo "5. status: DRAFT, PUBLISH, PENDING, PRIVATE のいずれか"
echo "6. date: 指定する場合はISO 8601形式（例: 2025-01-20T10:00:00）"
echo "7. featuredImageId: メディアライブラリの画像IDを指定（別途アップロードが必要）"