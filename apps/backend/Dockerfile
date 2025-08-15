FROM wordpress:6.7-php8.4-apache

# 基本設定（変更なし）
RUN docker-php-ext-install mysqli pdo pdo_mysql
RUN apt-get update && apt-get install -y \
    libzip-dev unzip curl \
    && docker-php-ext-install zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Apache設定（変更なし）
RUN a2enmod rewrite
RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf
RUN mkdir -p /cloudsql && chown www-data:www-data /cloudsql
RUN chown -R www-data:www-data /var/www/html
RUN sed -i 's/Listen 80/Listen 0.0.0.0:8080/' /etc/apache2/ports.conf && \
    sed -i 's/:80>/:8080>/' /etc/apache2/sites-available/000-default.conf

# WordPress設定
RUN mkdir -p /var/www/html/wp-content/mu-plugins
COPY wp-config.php /var/www/html/

# プラグインセットアップ
# シンボリックリンクを含むファイルをコピー
COPY setup-wordpress.sh /tmp/setup-wordpress.sh
RUN chmod +x /tmp/setup-wordpress.sh && \
    cd /var/www/html && \
    WP_ENV=production BACKEND_DIR=/var/www/html /tmp/setup-wordpress.sh && \
    rm /tmp/setup-wordpress.sh && \
    echo "Plugin setup completed"

# wp-contentディレクトリをコピー（カスタムテーマ、mu-pluginsなど）
COPY wp-content/ /var/www/html/wp-content/

# 🔑 修正：正しいディレクトリでComposerインストール
RUN cd /var/www/html/wp-content/mu-plugins/gcs-integration && \
    if [ -f composer.json ]; then \
    composer install --no-dev --optimize-autoloader && \
    rm -rf vendor/bin && \
    echo "✅ GCS dependencies installed in gcs-integration/"; \
    else \
    echo "❌ composer.json not found in gcs-integration/"; \
    exit 1; \
    fi

# 🚨 重要：Dockerfileでのプラグインコード生成を削除
# 既存のファイル構造を尊重し、上書きしない

# WordPress初期化スクリプト（変更なし）
RUN cat > /usr/local/bin/wordpress-init.sh << 'EOF'
#!/bin/bash
set -e
echo "=== WordPress Cloud Run Init ==="
echo "PORT: ${PORT:-8080}"
echo "HOST: ${HOST:-0.0.0.0}"
echo "BUCKET_NAME: ${BUCKET_NAME:-not set}"

if [ ! -z "$PORT" ] && [ "$PORT" != "8080" ]; then
echo "Changing Apache port to $PORT"
sed -i "s/Listen 0.0.0.0:8080/Listen 0.0.0.0:$PORT/" /etc/apache2/ports.conf
sed -i "s/:8080>/:$PORT>/" /etc/apache2/sites-available/000-default.conf
fi
echo "WordPress init completed"
EOF

RUN chmod +x /usr/local/bin/wordpress-init.sh

# エントリーポイント（変更なし）
RUN cat > /usr/local/bin/cloud-run-entrypoint.sh << 'EOF'
#!/bin/bash
set -e
/usr/local/bin/wordpress-init.sh
exec /usr/local/bin/docker-entrypoint.sh "$@"
EOF

RUN chmod +x /usr/local/bin/cloud-run-entrypoint.sh

# デバッグエンドポイント
RUN echo "<?php phpinfo(); ?>" > /var/www/html/debug.php
RUN echo "<?php http_response_code(200); echo 'OK - ' . date('Y-m-d H:i:s'); ?>" > /var/www/html/health.php

# 🔑 修正：正しいパスでGCSテスト
RUN cat > /var/www/html/test-gcs.php << 'EOF'
<?php
$vendor_path = '/var/www/html/wp-content/mu-plugins/gcs-integration/vendor/autoload.php';
if (file_exists($vendor_path)) {
require_once $vendor_path;
echo "<p>✅ Composer autoload found at: $vendor_path</p>";
} else {
echo "<p>❌ Composer dependencies not found at: $vendor_path</p>";
echo "<p>Available files:</p><pre>";
if (is_dir('/var/www/html/wp-content/mu-plugins/')) {
print_r(scandir('/var/www/html/wp-content/mu-plugins/'));
}
echo "</pre>";
exit;
}

use Google\Cloud\Storage\StorageClient;

header('Content-Type: text/html; charset=utf-8');
echo "<h1>Cloud Storage Connection Test (Fixed)</h1>";

$bucket_name = getenv('BUCKET_NAME');
echo "<p><strong>Bucket Name:</strong> " . ($bucket_name ?: 'NOT SET') . "</p>";

if (!$bucket_name) {
echo "<p>❌ BUCKET_NAME environment variable not set</p>";
exit;
}

try {
$storage = new StorageClient();
$bucket = $storage->bucket($bucket_name);

echo "<h2>Connection Test Results:</h2>";

if ($bucket->exists()) {
echo "<p>✅ Bucket exists and accessible</p>";

try {
$objects = $bucket->objects(['maxResults' => 1]);
echo "<p>✅ List permission: OK</p>";
} catch (Exception $e) {
echo "<p>❌ List permission: Failed - " . $e->getMessage() . "</p>";
}

try {
$test_object_name = 'test/connection-test-' . uniqid() . '.txt';
$test_content = 'Test file created at: ' . date('Y-m-d H:i:s');

$object = $bucket->upload($test_content, ['name' => $test_object_name]);
echo "<p>✅ Write permission: OK (uploaded: " . $test_object_name . ")</p>";

$object->delete();
echo "<p>✅ Delete permission: OK</p>";

} catch (Exception $e) {
echo "<p>❌ Write/Delete permission: Failed - " . $e->getMessage() . "</p>";
}

} else {
echo "<p>❌ Bucket does not exist or is not accessible</p>";
}

} catch (Exception $e) {
echo "<p>❌ Connection Error: " . $e->getMessage() . "</p>";
}

echo "<h2>File Structure Debug:</h2>";
echo "<p>Checking MU-Plugins structure:</p><pre>";
if (is_dir('/var/www/html/wp-content/mu-plugins/gcs-integration/')) {
echo "gcs-integration/ contents:\n";
print_r(scandir('/var/www/html/wp-content/mu-plugins/gcs-integration/'));

if (is_dir('/var/www/html/wp-content/mu-plugins/gcs-integration/vendor/')) {
echo "\nvendor/ exists: ✅\n";
} else {
echo "\nvendor/ missing: ❌\n";
}
}
echo "</pre>";
?>
EOF

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/cloud-run-entrypoint.sh"]
CMD ["apache2-foreground"]