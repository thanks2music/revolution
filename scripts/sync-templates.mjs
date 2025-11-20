#!/usr/bin/env node
// revolution/scripts/sync-templates.mjs
//
// Usage:
//   node scripts/sync-templates.mjs           # 通常実行
//   node scripts/sync-templates.mjs --dry-run # Dry-run（確認のみ）
//
// Environment Variables:
//   TEMPLATES_REPO_PATH - テンプレートリポジトリのパス（デフォルト: ../revolution-templates）

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ===============================================
// 設定
// ===============================================

// 1. プロジェクトルート（このスクリプトは常にルートから呼ぶ前提）
const projectRoot = process.cwd();

// 2. デフォルトのテンプレートリポジトリパス
//    ローカルでは ../revolution-templates を想定
const defaultTemplatesRepoPath = path.join(projectRoot, '..', 'revolution-templates');

// 3. 環境変数で上書き可能（CI では ./revolution-templates を渡す）
const templatesRepoPath = process.env.TEMPLATES_REPO_PATH || defaultTemplatesRepoPath;

// 4. private リポ内の YAML / Markdown の場所
const yamlSrcDir = path.join(templatesRepoPath, 'ai-writer', 'posts', 'yaml');
const markdownSrcDir = path.join(templatesRepoPath, 'ai-writer', 'posts', 'markdown');
const configSrcDir = path.join(templatesRepoPath, 'ai-writer', 'config');

// 5. public リポ側の配置先
//    apps/ai-writer/templates/ 配下にフラットにコピーする
//    apps/ai-writer/config/ に設定ファイルをコピーする
const destDir = path.join(projectRoot, 'apps', 'ai-writer', 'templates');
const configDestDir = path.join(projectRoot, 'apps', 'ai-writer', 'config');

// 6. オプション解析
const isDryRun = process.argv.includes('--dry-run');

// ===============================================
// ログ出力ユーティリティ
// ===============================================

const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  dryRun: (msg) => console.log(`🔍 [DRY-RUN] ${msg}`),
};

// ===============================================
// バリデーション
// ===============================================

function ensureDirExists(dirPath, label) {
  if (!fs.existsSync(dirPath)) {
    log.error(`${label} ディレクトリが見つかりません: ${dirPath}`);
    log.error('   revolution と revolution-templates の配置や TEMPLATES_REPO_PATH を確認してください。');
    process.exit(1);
  }
}

function validateGitRepository() {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: templatesRepoPath,
      stdio: 'pipe',
    });
  } catch {
    log.error(`${templatesRepoPath} はGitリポジトリではありません`);
    log.error('   gh repo clone thanks2music/revolution-templates でクローンしてください。');
    process.exit(1);
  }
}

// ===============================================
// Gitコミット情報の取得
// ===============================================

function getGitCommitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: templatesRepoPath,
      encoding: 'utf8',
    }).trim();

    const message = execSync('git log -1 --pretty=%s', {
      cwd: templatesRepoPath,
      encoding: 'utf8',
    }).trim();

    const date = execSync('git log -1 --pretty=%ai', {
      cwd: templatesRepoPath,
      encoding: 'utf8',
    }).trim();

    return { hash, message, date };
  } catch (error) {
    log.error('Gitコミット情報の取得に失敗しました');
    throw error;
  }
}

// ===============================================
// ファイルコピー
// ===============================================

function copyAllFiles(srcDir, destDir) {
  const files = fs.readdirSync(srcDir);

  if (files.length === 0) {
    log.warn(`ファイルが見つかりません: ${srcDir}`);
    return 0;
  }

  let copiedCount = 0;

  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);

    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) continue; // ディレクトリなどはスキップ

    if (isDryRun) {
      log.dryRun(`${srcPath} → ${destPath}`);
    } else {
      fs.copyFileSync(srcPath, destPath);
      log.success(`コピー: ${file}`);
    }

    copiedCount++;
  }

  return copiedCount;
}

// ===============================================
// バージョン情報ファイルの作成
// ===============================================

function writeVersionInfo(commitInfo) {
  const versionInfo = {
    syncedAt: new Date().toISOString(),
    repository: 'thanks2music/revolution-templates',
    commit: commitInfo,
  };

  const versionFilePath = path.join(destDir, 'VERSION.json');

  if (isDryRun) {
    log.dryRun(`VERSION.json に書き込み:\n${JSON.stringify(versionInfo, null, 2)}`);
  } else {
    fs.writeFileSync(versionFilePath, JSON.stringify(versionInfo, null, 2), 'utf8');
    log.success(`バージョン情報を書き込みました: VERSION.json`);
  }
}

// ===============================================
// メイン処理
// ===============================================

function main() {
  log.info('='.repeat(60));
  log.info('テンプレート同期スクリプト');
  log.info('='.repeat(60));

  if (isDryRun) {
    log.info('モード: DRY-RUN (実際のファイル操作は行われません)');
  }

  log.info(`ソース: ${templatesRepoPath}`);
  log.info(`宛先  : `);
  log.info(`  - テンプレート: ${destDir}`);
  log.info(`  - 設定ファイル: ${configDestDir}`);
  log.info('');

  // バリデーション
  ensureDirExists(templatesRepoPath, 'テンプレートリポジトリ');
  ensureDirExists(yamlSrcDir, 'YAML テンプレート');
  ensureDirExists(markdownSrcDir, 'Markdown テンプレート');
  ensureDirExists(configSrcDir, 'Config ファイル');
  validateGitRepository();

  // Gitコミット情報の取得
  const commitInfo = getGitCommitInfo();
  log.info(`コミット: ${commitInfo.hash} - ${commitInfo.message}`);
  log.info(`日時    : ${commitInfo.date}`);
  log.info('');

  // 出力先ディレクトリを用意
  if (!isDryRun) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.mkdirSync(configDestDir, { recursive: true });
  }

  // ファイルコピー
  log.info('ファイルをコピー中...');
  const yamlCount = copyAllFiles(yamlSrcDir, destDir);
  const markdownCount = copyAllFiles(markdownSrcDir, destDir);
  const configCount = copyAllFiles(configSrcDir, configDestDir);
  const totalCount = yamlCount + markdownCount + configCount;
  log.info('');

  // バージョン情報の書き込み
  writeVersionInfo(commitInfo);
  log.info('');

  // 完了メッセージ
  if (isDryRun) {
    log.success(`✨ DRY-RUN完了: ${totalCount}ファイルがコピー対象です`);
    log.info('実際に同期するには --dry-run を外して実行してください');
  } else {
    log.success(`✨ 同期完了: ${totalCount}ファイルをコピーしました`);
    log.info(`バージョン: ${commitInfo.hash}`);
  }
}

// ===============================================
// エントリーポイント
// ===============================================

try {
  main();
} catch (error) {
  log.error('同期中にエラーが発生しました');
  console.error(error);
  process.exit(1);
}
