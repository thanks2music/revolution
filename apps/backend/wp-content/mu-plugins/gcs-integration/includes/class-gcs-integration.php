<?php

/**
 * GCS Integration Main Class
 */

// 直接アクセス防止
if (!defined('ABSPATH')) {
  exit;
}

// Composer autoload
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Google\Cloud\Storage\StorageClient;

class GCSIntegration
{
  private $storage;
  private $bucket;
  private $bucket_name;
  private $is_gcs_available = false;

  public function __construct()
  {
    $this->bucket_name = getenv('BUCKET_NAME');
    error_log('GCS Integration: Initializing with bucket name: ' . ($this->bucket_name ?: 'NOT SET'));

    if ($this->bucket_name) {
      $this->init_gcs_connection();
    } else {
      error_log('GCS Integration: BUCKET_NAME environment variable not set');
    }

    // GCS利用可能かどうかに関わらずフックを設定
    $this->init_hooks();
  }

  private function init_gcs_connection()
  {
    try {
      // Cloud Run環境での認証を明示的に設定
      $config = [];
      
      // プロジェクトIDを明示的に設定
      $project_id = getenv('GCP_PROJECT') ?: getenv('GOOGLE_CLOUD_PROJECT');
      if ($project_id) {
        $config['projectId'] = $project_id;
        error_log('GCS Integration: Using project ID: ' . $project_id);
      }
      
      $this->storage = new StorageClient($config);
      $this->bucket = $this->storage->bucket($this->bucket_name);

      // 接続テスト
      if ($this->bucket->exists()) {
        $this->is_gcs_available = true;
        error_log('GCS Integration: Connected successfully to bucket ' . $this->bucket_name);
      } else {
        error_log('GCS Integration: Bucket does not exist: ' . $this->bucket_name);
      }
    } catch (Exception $e) {
      error_log('GCS Integration: Connection failed - ' . $e->getMessage());
      $this->is_gcs_available = false;
    }
  }

  private function init_hooks()
  {
    add_filter('wp_handle_upload', array($this, 'handle_upload'), 10, 2);
    add_filter('wp_delete_file', array($this, 'handle_delete'));
    add_filter('upload_dir', array($this, 'custom_upload_dir'));

    // 管理画面での GCS 状態表示
    add_action('admin_notices', array($this, 'admin_notices'));
  }

  public function handle_upload($upload, $context = 'upload')
  {
    if (!$this->is_gcs_available) {
      error_log('GCS Integration: GCS not available, using local storage');
      return $upload;
    }

    if (!isset($upload['file']) || !isset($upload['url'])) {
      return $upload;
    }

    try {
      $local_file_path = $upload['file'];
      $file_name = basename($local_file_path);

      // WordPress のアップロードディレクトリ構造を取得
      $upload_dir = wp_upload_dir();
      $relative_path = str_replace($upload_dir['basedir'], '', dirname($local_file_path));

      // GCS オブジェクト名を構築（wp-content/uploads/YYYY/MM/filename.ext）
      $gcs_object_name = 'wp-content/uploads' . $relative_path . '/' . $file_name;

      // Cloud Storage にアップロード
      $this->bucket->upload(
        fopen($local_file_path, 'r'),
        [
          'name' => $gcs_object_name,
          'metadata' => [
            'originalPath' => $local_file_path,
            'uploadTime' => date('c'),
            'context' => $context
          ]
        ]
      );

      // URL を Cloud Storage に変更
      $upload['url'] = 'https://storage.googleapis.com/' . $this->bucket_name . '/' . $gcs_object_name;

      // ローカルファイルを削除
      if (file_exists($local_file_path)) {
        unlink($local_file_path);
      }

      error_log('GCS Integration: Successfully uploaded ' . $gcs_object_name);
    } catch (Exception $e) {
      error_log('GCS Integration: Upload failed - ' . $e->getMessage());
      // GCS アップロード失敗時はローカルファイルを維持
    }

    return $upload;
  }

  public function handle_delete($file_path)
  {
    if (!$this->is_gcs_available) {
      return $file_path;
    }

    try {
      // WordPress のアップロードディレクトリ情報を取得
      $upload_dir = wp_upload_dir();
      $uploads_basedir = $upload_dir['basedir'];

      // アップロードディレクトリ内のファイルかチェック
      if (strpos($file_path, $uploads_basedir) === 0) {
        // アップロードディレクトリからの相対パスを取得
        $relative_path = str_replace($uploads_basedir, '', $file_path);
        $gcs_object_name = 'wp-content/uploads' . $relative_path;

        $object = $this->bucket->object($gcs_object_name);
        if ($object->exists()) {
          $object->delete();
          error_log('GCS Integration: Successfully deleted ' . $gcs_object_name);
        } else {
          error_log('GCS Integration: Object not found for deletion: ' . $gcs_object_name);
        }
      }
    } catch (Exception $e) {
      error_log('GCS Integration: Delete failed - ' . $e->getMessage());
    }

    return $file_path;
  }

  public function custom_upload_dir($dirs)
  {
    if ($this->is_gcs_available) {
      $base_url_gcs = 'https://storage.googleapis.com/' . $this->bucket_name . '/wp-content/uploads';
      $dirs['baseurl'] = $base_url_gcs;
      $dirs['url'] = $base_url_gcs . $dirs['subdir'];
    }
    return $dirs;
  }

  public function admin_notices()
  {
    if (current_user_can('manage_options')) {
      if ($this->is_gcs_available) {
        echo '<div class="notice notice-success"><p><strong>GCS Integration:</strong> ✅ Connected to bucket: ' . $this->bucket_name . '</p></div>';
      } else {
        echo '<div class="notice notice-warning"><p><strong>GCS Integration:</strong> ⚠️ Not available. Check configuration.</p></div>';
      }
    }
  }
}

// プラグイン初期化
new GCSIntegration();
