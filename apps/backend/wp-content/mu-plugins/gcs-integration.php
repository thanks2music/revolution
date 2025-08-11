<?php

/**
 * Plugin Name: Google Cloud Storage Integration
 * Description: WordPress メディアファイルを Google Cloud Storage に保存
 * Version: 1.0.1
 * Author: thanks2music
 * License: MIT
 */

// 直接アクセス防止
if (!defined('ABSPATH')) {
	exit;
}

// メインファイルを読み込み
require_once __DIR__ . '/gcs-integration/includes/class-gcs-integration.php';
