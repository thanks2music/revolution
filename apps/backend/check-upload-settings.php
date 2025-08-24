<?php
/**
 * WordPressのアップロード設定を確認・修正するスクリプト
 * 
 * 使用方法: Cloud RunのサービスURLに /check-upload-settings.php でアクセス
 */

// WordPress環境をロード
define('WP_USE_THEMES', false);
require('./wp-load.php');

// 管理者権限チェック（セキュリティ）
if (!current_user_can('manage_options')) {
    wp_die('管理者権限が必要です。WordPressにログインしてからアクセスしてください。');
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html>
<head>
    <title>Upload Settings Check</title>
    <style>
        body { font-family: monospace; margin: 20px; }
        .success { color: green; }
        .error { color: red; }
        .warning { color: orange; }
        pre { background: #f4f4f4; padding: 10px; }
    </style>
</head>
<body>
    <h1>WordPress Upload Settings Diagnostic</h1>
    
    <?php
    // 1. 現在の設定を確認
    echo "<h2>1. Current Upload Settings</h2>";
    echo "<pre>";
    
    $upload_path = get_option('upload_path');
    $upload_url_path = get_option('upload_url_path');
    $uploads_use_yearmonth_folders = get_option('uploads_use_yearmonth_folders');
    
    echo "upload_path: " . var_export($upload_path, true) . "\n";
    echo "upload_url_path: " . var_export($upload_url_path, true) . "\n";
    echo "uploads_use_yearmonth_folders: " . var_export($uploads_use_yearmonth_folders, true) . "\n";
    echo "</pre>";
    
    // 2. wp_upload_dir() の出力を確認
    echo "<h2>2. wp_upload_dir() Output</h2>";
    echo "<pre>";
    $upload_dir = wp_upload_dir();
    print_r($upload_dir);
    echo "</pre>";
    
    // 3. ディレクトリの存在と権限を確認
    echo "<h2>3. Directory Check</h2>";
    $base_dir = $upload_dir['basedir'];
    $current_dir = $upload_dir['path'];
    
    echo "<p>Base directory: <code>$base_dir</code></p>";
    if (file_exists($base_dir)) {
        echo "<p class='success'>✅ Base directory exists</p>";
        $perms = substr(sprintf('%o', fileperms($base_dir)), -4);
        echo "<p>Permissions: $perms</p>";
        
        if (is_writable($base_dir)) {
            echo "<p class='success'>✅ Base directory is writable</p>";
        } else {
            echo "<p class='error'>❌ Base directory is NOT writable</p>";
        }
    } else {
        echo "<p class='error'>❌ Base directory does NOT exist</p>";
    }
    
    echo "<p>Current upload directory: <code>$current_dir</code></p>";
    if (file_exists($current_dir)) {
        echo "<p class='success'>✅ Current directory exists</p>";
    } else {
        echo "<p class='warning'>⚠️ Current directory does NOT exist</p>";
        
        // ディレクトリ作成を試みる
        if (wp_mkdir_p($current_dir)) {
            echo "<p class='success'>✅ Successfully created directory</p>";
        } else {
            echo "<p class='error'>❌ Failed to create directory</p>";
        }
    }
    
    // 4. 修正提案
    echo "<h2>4. Recommended Fix</h2>";
    
    if (!empty($upload_path) || !empty($upload_url_path)) {
        echo "<p class='warning'>⚠️ カスタムアップロードパスが設定されています。</p>";
        echo "<p>以下のSQLをCloud SQLで実行して修正してください：</p>";
        echo "<pre>";
        echo "UPDATE wp_options SET option_value = '' WHERE option_name = 'upload_path';\n";
        echo "UPDATE wp_options SET option_value = '' WHERE option_name = 'upload_url_path';\n";
        echo "</pre>";
        
        // 修正ボタン（オプション）
        if (isset($_GET['fix']) && $_GET['fix'] === 'true') {
            update_option('upload_path', '');
            update_option('upload_url_path', '');
            echo "<p class='success'>✅ 設定をリセットしました。ページをリロードして確認してください。</p>";
        } else {
            echo "<p><a href='?fix=true' onclick='return confirm(\"本当に設定をリセットしますか？\")'>🔧 設定を自動修正する</a></p>";
        }
    } else {
        echo "<p class='success'>✅ アップロードパス設定は正常です。</p>";
    }
    
    // 5. GCS Integration状態
    echo "<h2>5. GCS Integration Status</h2>";
    echo "<pre>";
    echo "BUCKET_NAME: " . getenv('BUCKET_NAME') . "\n";
    echo "GOOGLE_CLOUD_PROJECT: " . getenv('GOOGLE_CLOUD_PROJECT') . "\n";
    
    // GCS Integrationクラスの状態確認
    if (class_exists('GCSIntegration')) {
        echo "GCS Integration class: ✅ Loaded\n";
    } else {
        echo "GCS Integration class: ❌ Not loaded\n";
    }
    echo "</pre>";
    
    // 6. テストアップロード
    echo "<h2>6. Test Upload</h2>";
    echo "<p>メディアライブラリから画像をアップロードしてテストしてください。</p>";
    ?>
</body>
</html>