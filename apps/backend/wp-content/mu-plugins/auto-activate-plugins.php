<?php
/**
 * 必須プラグインの自動有効化
 * 
 * このファイルは mu-plugins ディレクトリに配置されているため、
 * WordPress起動時に自動的に読み込まれます。
 */

add_action('admin_init', function() {
    $required_plugins = [
        'wp-graphql/wp-graphql.php',
        'classic-editor/classic-editor.php',
    ];
    
    // 開発環境のみ有効化
    if (defined('WP_DEBUG') && WP_DEBUG) {
        $required_plugins[] = 'debug-bar/debug-bar.php';
        $required_plugins[] = 'query-monitor/query-monitor.php';
    }
    
    require_once(ABSPATH . 'wp-admin/includes/plugin.php');
    
    foreach ($required_plugins as $plugin) {
        if (file_exists(WP_PLUGIN_DIR . '/' . $plugin) && !is_plugin_active($plugin)) {
            activate_plugin($plugin);
        }
    }
});
