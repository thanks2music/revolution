FROM wordpress:6.7-php8.4-apache

# デフォルトプラグインを削除（docker-entrypoint.shがコピーする前に削除）
RUN rm -rf /usr/src/wordpress/wp-content/plugins/akismet \
    && rm -f /usr/src/wordpress/wp-content/plugins/hello.php \
    && echo "Removed default plugins from /usr/src/wordpress/"

# 基本設定
RUN docker-php-ext-install mysqli pdo pdo_mysql
RUN apt-get update && apt-get install -y \
	libzip-dev unzip curl less jq \
	&& docker-php-ext-install zip \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# WP-CLI インストール
# プロダクション環境でも利用可能にするため、ビルド時に組み込み
RUN curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
	&& chmod +x wp-cli.phar \
	&& mv wp-cli.phar /usr/local/bin/wp \
	&& echo "✅ WP-CLI installed successfully" \
	&& wp --info --allow-root

# Apache設定（変更なし）
RUN a2enmod rewrite
RUN echo "ServerName localhost" >> /etc/apache2/apache2.conf
RUN mkdir -p /cloudsql && chown www-data:www-data /cloudsql
RUN chown -R www-data:www-data /var/www/html
RUN sed -i 's/Listen 80/Listen 0.0.0.0:8080/' /etc/apache2/ports.conf && \
	sed -i 's/:80>/:8080>/' /etc/apache2/sites-available/000-default.conf

# WordPress設定（後でコピーするため、ここではコメントアウト）
# COPY wp-config.php /var/www/html/

# wp-contentディレクトリをコピー（カスタムテーマ、mu-pluginsなど）
COPY wp-content/ /var/www/html/wp-content/

# プラグインセットアップ（新方式: plugins.json + install-plugins.sh）
# プラグイン設定ファイルとインストールスクリプトをコピー
# 注意: プラグインインストールはコンテナ起動時に実行（WordPress初期化後）
COPY plugins.json /var/www/html/plugins.json
COPY install-plugins.sh /var/www/html/install-plugins.sh
COPY setup-premium-plugins.sh /tmp/setup-premium-plugins.sh

# スクリプトに実行権限を付与
RUN chmod +x /var/www/html/install-plugins.sh && \
	chmod +x /tmp/setup-premium-plugins.sh && \
	cp /tmp/setup-premium-plugins.sh /var/www/html/ && \
	rm /tmp/setup-premium-plugins.sh && \
	echo "✅ Plugin scripts prepared (will run at container startup)"

# 🔑 重要：COPYの後に権限を設定（COPYが権限を上書きするため）
RUN mkdir -p /var/www/html/wp-content/uploads \
	&& mkdir -p /var/www/html/wp-content/upgrade \
	&& chmod -R 755 /var/www/html/wp-content/uploads \
	&& chmod -R 755 /var/www/html/wp-content/upgrade \
	&& chown -R www-data:www-data /var/www/html/wp-content/uploads \
	&& chown -R www-data:www-data /var/www/html/wp-content/upgrade \
	&& echo "✅ Upload directory permissions fixed"

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

# カスタムwp-config.phpを一時保存（起動時にコピーする）
COPY wp-config.php /tmp/wp-config.php

# WordPress初期化スクリプト
RUN cat > /usr/local/bin/wordpress-init.sh << 'EOF'
#!/bin/bash
set -e
echo "=== WordPress Cloud Run Init ==="
echo "PORT: ${PORT:-8080}"
echo "HOST: ${HOST:-0.0.0.0}"
echo "BUCKET_NAME: ${BUCKET_NAME:-not set}"

# カスタムwp-config.phpを強制的にコピー（WordPressの標準設定を上書き）
if [ -f /tmp/wp-config.php ]; then
echo "Copying custom wp-config.php..."
cp -f /tmp/wp-config.php /var/www/html/wp-config.php
chown www-data:www-data /var/www/html/wp-config.php
echo "Custom wp-config.php applied successfully"
else
echo "Warning: Custom wp-config.php not found in /tmp/"
fi

# デフォルトテーマの削除（カスタムテーマのみ使用）
if [ -d /var/www/html/wp-content/themes ]; then
echo "Removing default WordPress themes..."
rm -rf /var/www/html/wp-content/themes/twentytwenty*
echo "Default themes removed"
fi

# デフォルトプラグインの削除（念のための二重チェック）
# 注: /usr/src/wordpress/ から既に削除済みだが、万が一のバックアップとして実行
echo "Checking for any remaining default plugins..."
rm -rf /var/www/html/wp-content/plugins/akismet
rm -f /var/www/html/wp-content/plugins/hello.php
echo "Default plugins cleanup completed (akismet, hello.php)"

# 開発中プラグインの削除（本番環境には不要）
echo "Removing development plugins..."
rm -rf /var/www/html/wp-content/plugins/ai-writer
echo "Development plugins removed (ai-writer)"

# 削除後の確認（診断用）
echo "Remaining plugins:"
ls -1 /var/www/html/wp-content/plugins/ 2>/dev/null || echo "  (plugins directory empty or not found)"

if [ ! -z "$PORT" ] && [ "$PORT" != "8080" ]; then
echo "Changing Apache port to $PORT"
sed -i "s/Listen 0.0.0.0:8080/Listen 0.0.0.0:$PORT/" /etc/apache2/ports.conf
sed -i "s/:8080>/:$PORT>/" /etc/apache2/sites-available/000-default.conf
fi

echo "WordPress init completed"
EOF

RUN chmod +x /usr/local/bin/wordpress-init.sh

# 元のdocker-entrypoint.shをバックアップし、プラグインインストールを追加したラッパーを作成
# 注意: 元のスクリプトは最後に exec "$@" するため、その直前にプラグインインストールを挿入する
RUN cp /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.orig && \
    awk '/^exec "\$@"$/ { \
        print "# === カスタム: プラグインインストール（WordPress初期化後、apache起動前） ==="; \
        print "if [[ \"$1\" == apache2* ]] || [ \"$1\" = \"php-fpm\" ]; then"; \
        print "    # 無料プラグインのインストール"; \
        print "    if [ -f /var/www/html/install-plugins.sh ]; then"; \
        print "        echo \"Installing free plugins from plugins.json...\""; \
        print "        cd /var/www/html && ./install-plugins.sh"; \
        print "    fi"; \
        print "    "; \
        print "    # プレミアムプラグインセットアップ"; \
        print "    if [ -f /var/www/html/setup-premium-plugins.sh ]; then"; \
        print "        echo \"Setting up premium plugins...\""; \
        print "        cd /var/www/html && ./setup-premium-plugins.sh"; \
        print "    fi"; \
        print "fi"; \
        print "# === カスタムプラグインインストール終了 ==="; \
        print ""; \
    } { print }' /usr/local/bin/docker-entrypoint.orig > /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# エントリーポイント（wordpress-init.shを先に実行）
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

# 診断用ディレクトリの作成（WordPressルーティング外）
RUN mkdir -p /var/www/diagnostics && chown www-data:www-data /var/www/diagnostics

# Apache設定：/diagnosticsパスを直接サーブ
RUN echo 'Alias /diagnostics /var/www/diagnostics' >> /etc/apache2/sites-available/000-default.conf && \
    echo '<Directory "/var/www/diagnostics">' >> /etc/apache2/sites-available/000-default.conf && \
    echo '    Options Indexes FollowSymLinks' >> /etc/apache2/sites-available/000-default.conf && \
    echo '    AllowOverride None' >> /etc/apache2/sites-available/000-default.conf && \
    echo '    Require all granted' >> /etc/apache2/sites-available/000-default.conf && \
    echo '</Directory>' >> /etc/apache2/sites-available/000-default.conf

# 総合診断スクリプト
RUN cat > /var/www/diagnostics/permissions.php << 'EOF'
<?php
header('Content-Type: text/plain; charset=utf-8');
echo "=== WordPress File System Diagnostic Report ===\n";
echo "Timestamp: " . date('Y-m-d H:i:s T') . "\n\n";

// Process Information
echo "=== Process Information ===\n";
echo "UID: " . posix_getuid() . "\n";
echo "GID: " . posix_getgid() . "\n";
if (function_exists('posix_getpwuid')) {
    $user = posix_getpwuid(posix_getuid());
    echo "User: " . ($user['name'] ?? 'unknown') . "\n";
}
if (function_exists('posix_getgrgid')) {
    $group = posix_getgrgid(posix_getgid());
    echo "Group: " . ($group['name'] ?? 'unknown') . "\n";
}

// Directory Analysis
$critical_dirs = [
    '/var/www/html' => 'WordPress root',
    '/var/www/html/wp-content' => 'Content directory',
    '/var/www/html/wp-content/uploads' => 'Uploads directory',
    '/var/www/html/wp-content/upgrade' => 'Upgrade directory',
    '/var/www/html/wp-content/mu-plugins' => 'Must-use plugins',
    '/tmp' => 'Temporary directory'
];

echo "\n=== Directory Analysis ===\n";
foreach ($critical_dirs as $dir => $description) {
    echo "Directory: $dir ($description)\n";
    if (file_exists($dir)) {
        $perms = fileperms($dir);
        $octal = substr(sprintf('%o', $perms), -4);
        $owner = fileowner($dir);
        $group = filegroup($dir);
        
        echo "  Permissions: $octal\n";
        echo "  Owner UID: $owner\n";
        echo "  Group GID: $group\n";
        echo "  Writable: " . (is_writable($dir) ? 'YES' : 'NO') . "\n";
        echo "  Readable: " . (is_readable($dir) ? 'YES' : 'NO') . "\n";
        
        if (is_dir($dir) && is_readable($dir)) {
            try {
                $files = scandir($dir);
                $count = count($files) - 2;
                echo "  Items: $count\n";
                
                // Special handling for uploads directory
                if ($dir === '/var/www/html/wp-content/uploads') {
                    $visible_items = array_slice($files, 2, 5);
                    echo "  Sample contents: " . implode(', ', $visible_items) . 
                         (count($files) > 7 ? " ..." : "") . "\n";
                }
            } catch (Exception $e) {
                echo "  Scan error: " . $e->getMessage() . "\n";
            }
        }
    } else {
        echo "  Status: NOT EXISTS\n";
    }
    echo "\n";
}

// Write Permission Tests
echo "=== Write Permission Tests ===\n";

// Test 1: uploads directory
$test_file = '/var/www/html/wp-content/uploads/diagnostic-test-' . uniqid() . '.txt';
echo "Testing file write to uploads directory:\n";
echo "  Target: $test_file\n";

if (file_put_contents($test_file, "Diagnostic test content\nCreated: " . date('c'))) {
    echo "  Result: SUCCESS ✅\n";
    if (unlink($test_file)) {
        echo "  Cleanup: SUCCESS ✅\n";
    } else {
        echo "  Cleanup: FAILED ❌\n";
    }
} else {
    echo "  Result: FAILED ❌\n";
    $error = error_get_last();
    if ($error) {
        echo "  Error: " . $error['message'] . "\n";
    }
}

// Test 2: directory creation
$test_dir = '/var/www/html/wp-content/uploads/diagnostic-dir-' . uniqid();
echo "\nTesting directory creation in uploads:\n";
echo "  Target: $test_dir\n";

if (mkdir($test_dir, 0755, true)) {
    echo "  Result: SUCCESS ✅\n";
    if (rmdir($test_dir)) {
        echo "  Cleanup: SUCCESS ✅\n";
    } else {
        echo "  Cleanup: FAILED ❌\n";
    }
} else {
    echo "  Result: FAILED ❌\n";
    $error = error_get_last();
    if ($error) {
        echo "  Error: " . $error['message'] . "\n";
    }
}

// PHP Upload Settings
echo "\n=== PHP Upload Configuration ===\n";
echo "file_uploads: " . (ini_get('file_uploads') ? 'ON' : 'OFF') . "\n";
echo "upload_max_filesize: " . ini_get('upload_max_filesize') . "\n";
echo "post_max_size: " . ini_get('post_max_size') . "\n";
echo "max_file_uploads: " . ini_get('max_file_uploads') . "\n";
echo "upload_tmp_dir: " . (ini_get('upload_tmp_dir') ?: '/tmp (default)') . "\n";
echo "memory_limit: " . ini_get('memory_limit') . "\n";

// WordPress Integration Test
echo "\n=== WordPress Integration Test ===\n";
if (file_exists('/var/www/html/wp-load.php')) {
    echo "WordPress installation: FOUND ✅\n";
    
    // Try to load WordPress environment (carefully)
    try {
        define('WP_USE_THEMES', false);
        $original_dir = getcwd();
        chdir('/var/www/html');
        require_once('/var/www/html/wp-load.php');
        
        if (function_exists('wp_upload_dir')) {
            $upload_dir = wp_upload_dir();
            echo "WordPress upload_dir():\n";
            echo "  Base dir: " . $upload_dir['basedir'] . "\n";
            echo "  Path: " . $upload_dir['path'] . "\n";
            echo "  URL: " . $upload_dir['url'] . "\n";
            echo "  Error: " . ($upload_dir['error'] ?: 'None') . "\n";
        }
        
        chdir($original_dir);
    } catch (Exception $e) {
        echo "WordPress load error: " . $e->getMessage() . "\n";
    }
} else {
    echo "WordPress installation: NOT FOUND ❌\n";
}

// System Information
echo "\n=== System Information ===\n";
echo "PHP version: " . PHP_VERSION . "\n";
echo "Server software: " . ($_SERVER['SERVER_SOFTWARE'] ?? 'Unknown') . "\n";
echo "Document root: " . ($_SERVER['DOCUMENT_ROOT'] ?? 'Unknown') . "\n";

// Disk Space
echo "\n=== Disk Space ===\n";
$free_bytes = disk_free_space('/var/www/html');
$total_bytes = disk_total_space('/var/www/html');
echo "Free space: " . number_format($free_bytes / (1024*1024), 2) . " MB\n";
echo "Total space: " . number_format($total_bytes / (1024*1024), 2) . " MB\n";
echo "Used: " . number_format(($total_bytes - $free_bytes) / (1024*1024), 2) . " MB\n";

echo "\n=== Diagnostic Complete ===\n";
echo "Access this report at: /diagnostics/permissions.php\n";
?>
EOF

# 診断用インデックスページ
RUN cat > /var/www/diagnostics/index.php << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>WordPress Diagnostics</title>
    <meta charset="utf-8">
    <style>
        body { font-family: monospace; margin: 40px; }
        .link { display: block; margin: 10px 0; }
        .description { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>WordPress Diagnostics Dashboard</h1>
    <p>Available diagnostic tools:</p>
    
    <a href="permissions.php" class="link">
        <strong>📁 File System Permissions Analysis</strong><br>
        <span class="description">Comprehensive analysis of directory permissions, write tests, and WordPress integration</span>
    </a>
    
    <hr>
    <p><strong>Usage:</strong></p>
    <ul>
        <li>These tools bypass WordPress routing</li>
        <li>Access directly via /diagnostics/[tool].php</li>
        <li>Reports are in plain text for easy parsing</li>
    </ul>
    
    <p><strong>Timestamp:</strong> <?= date('Y-m-d H:i:s T') ?></p>
</body>
</html>
EOF

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
